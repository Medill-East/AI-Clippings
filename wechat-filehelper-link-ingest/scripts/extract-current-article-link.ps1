[CmdletBinding()]
param(
  [string]$InputJsonPath,
  [switch]$RequireMpWeixin = $true,
  [string]$ExpectedTitleFragment,
  [switch]$AllowBrowserFallback,
  [string]$ViewerHandle,
  [switch]$AllowInteractiveViewerActions
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WeChatArticleNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@

$script:CopyLinkLabel = ([char]0x590D)+([char]0x5236)+([char]0x94FE)+([char]0x63A5)
$script:OpenInBrowserLabel = ([char]0x4F7F)+([char]0x7528)+([char]0x9ED8)+([char]0x8BA4)+([char]0x6D4F)+([char]0x89C8)+([char]0x5668)+([char]0x6253)+([char]0x5F00)
$script:LogPath = $null
$script:MenuNavigationIndex = @{
  $script:OpenInBrowserLabel = 4
  $script:CopyLinkLabel = 6
}

function Write-ExtractorLog {
  param([string]$Message)

  if ([string]::IsNullOrWhiteSpace($script:LogPath)) {
    return
  }

  $line = '[{0}] {1}' -f ([DateTimeOffset]::Now.ToString('o')), $Message
  Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
}

function Get-TopLevelWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  return @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
}

function Get-Descendants {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Root
  )

  return @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
}

function Get-ClipboardTextSafe {
  try {
    return [System.Windows.Forms.Clipboard]::GetText()
  } catch {
    return ''
  }
}

function Clear-ClipboardSafe {
  try {
    [System.Windows.Forms.Clipboard]::Clear()
  } catch {
  }
}

function Send-Keys {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Keys,
    [int]$DelayMs = 220
  )

  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $DelayMs
}

function Click-Point {
  param(
    [Parameter(Mandatory = $true)]
    [int]$X,
    [Parameter(Mandatory = $true)]
    [int]$Y
  )

  [WeChatArticleNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 50
  [WeChatArticleNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [WeChatArticleNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Focus-Window {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Window
  )

  if ($null -eq $Window) {
    return
  }

  $handle = [IntPtr]$Window.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero) {
    return
  }

  if ([WeChatArticleNative]::IsIconic($handle)) {
    [WeChatArticleNative]::ShowWindowAsync($handle, 9) | Out-Null
    Start-Sleep -Milliseconds 150
  }

  [WeChatArticleNative]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 250
}

function Get-ElementRectangleObject {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element
  )

  if ($null -eq $Element) {
    return $null
  }

  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) {
    return $null
  }

  return [PSCustomObject]@{
    Left = [int][Math]::Round($rect.Left, 0)
    Top = [int][Math]::Round($rect.Top, 0)
    Width = [int][Math]::Round($rect.Width, 0)
    Height = [int][Math]::Round($rect.Height, 0)
  }
}

function Get-ControlTypeProgrammaticName {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element
  )

  if ($null -eq $Element) {
    return $null
  }

  try {
    $controlType = $Element.Current.ControlType
    if ($null -eq $controlType) {
      return $null
    }

    return [string]$controlType.ProgrammaticName
  } catch {
    return $null
  }
}

function Try-InvokeUiElement {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element
  )

  if ($null -eq $Element) {
    return $false
  }

  $invokePattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
      $invokePattern.Invoke()
      Start-Sleep -Milliseconds 250
      return $true
    }
  } catch {
  }

  $legacyPattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
      $legacyPattern.DoDefaultAction()
      Start-Sleep -Milliseconds 250
      return $true
    }
  } catch {
  }

  try {
    $point = $Element.GetClickablePoint()
    Click-Point -X ([int][Math]::Round($point.X, 0)) -Y ([int][Math]::Round($point.Y, 0))
    Start-Sleep -Milliseconds 250
    return $true
  } catch {
  }

  return $false
}

function Try-ActivateMenuActionWithEnter {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element,
    [Parameter(Mandatory = $true)]
    [scriptblock]$ValidateResult
  )

  if ($null -eq $Element) {
    return $null
  }

  $selectionPattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
      $selectionPattern.Select()
      Start-Sleep -Milliseconds 120
    }
  } catch {
  }

  try {
    $Element.SetFocus()
    Start-Sleep -Milliseconds 120
  } catch {
  }

  Send-Keys -Keys '{ENTER}' -DelayMs 260
  Start-Sleep -Milliseconds 600
  $candidate = & $ValidateResult
  if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
    return [string]$candidate
  }

  return $null
}

function Try-ActivateMenuActionByKeyboardNavigation {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ActionLabel,
    [Parameter(Mandatory = $true)]
    [scriptblock]$ValidateResult
  )

  if (-not $script:MenuNavigationIndex.ContainsKey($ActionLabel)) {
    return $null
  }

  $targetIndex = [int]$script:MenuNavigationIndex[$ActionLabel]
  Write-ExtractorLog ("Using direct-down keyboard navigation for menu action: {0} (downCount={1})" -f $ActionLabel, $targetIndex)

  for ($i = 0; $i -lt $targetIndex; $i++) {
    Send-Keys -Keys '{DOWN}' -DelayMs 90
  }

  Start-Sleep -Milliseconds 120
  Send-Keys -Keys '{ENTER}' -DelayMs 260
  Start-Sleep -Milliseconds 700
  $candidate = & $ValidateResult
  if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
    return [string]$candidate
  }

  return $null
}

function Get-CurrentArticleWindow {
  param(
    [AllowEmptyString()]
    [string]$Handle
  )

  $wechatWindowName = ([char]0x5FAE) + ([char]0x4FE1)
  $windows = @(
    Get-TopLevelWindows |
      Where-Object {
        [string]$_.Current.ClassName -eq 'Chrome_WidgetWin_0' -and
        [string]$_.Current.Name -eq $wechatWindowName
      }
  )

  if (-not [string]::IsNullOrWhiteSpace($Handle)) {
    $matched = @($windows | Where-Object { [string]$_.Current.NativeWindowHandle -eq $Handle })
    if ($matched.Count -eq 1) {
      return $matched[0]
    }
  }

  if ($windows.Count -eq 1) {
    return $windows[0]
  }

  return $null
}

function Find-ViewerMenuButton {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ArticleWindow
  )

  $candidates = @(
    Get-Descendants -Root $ArticleWindow |
      Where-Object {
        $type = Get-ControlTypeProgrammaticName -Element $_
        if ($type -notin @('ControlType.Button', 'ControlType.SplitButton', 'ControlType.MenuItem')) {
          return $false
        }

        $rect = Get-ElementRectangleObject -Element $_
        if ($null -eq $rect) {
          return $false
        }

        $name = [string]$_.Current.Name
        $isTopRight = ($rect.Top -lt 220 -and $rect.Left -gt 700)
        $looksLikeMenu = ($name -eq '...' -or $name -eq '.' -or $name -like '*menu*')
        return $isTopRight -or $looksLikeMenu
      }
  )

  if ($candidates.Count -eq 0) {
    return $null
  }

  return @($candidates | Sort-Object { (Get-ElementRectangleObject -Element $_).Top }, { (Get-ElementRectangleObject -Element $_).Left })[0]
}

function Find-ViewerMenuAction {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ArticleWindow,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $candidates = @(
    Get-Descendants -Root $ArticleWindow |
      Where-Object {
        $name = [string]$_.Current.Name
        if ([string]::IsNullOrWhiteSpace($name) -or $name -notlike "*$Label*") {
          return $false
        }

        $type = Get-ControlTypeProgrammaticName -Element $_
        return $type -in @('ControlType.MenuItem', 'ControlType.Button', 'ControlType.Text')
      }
  )

  if ($candidates.Count -eq 0) {
    return $null
  }

  return $candidates | Select-Object -First 1
}

function Try-InvokeMenuActionByUiAutomation {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ArticleWindow,
    [Parameter(Mandatory = $true)]
    [string]$ActionLabel,
    [Parameter(Mandatory = $true)]
    [scriptblock]$ValidateResult
  )

  Focus-Window -Window $ArticleWindow
  $menuButton = Find-ViewerMenuButton -ArticleWindow $ArticleWindow
  if ($null -eq $menuButton) {
    Write-ExtractorLog ("UIA menu button not found for action: {0}" -f $ActionLabel)
    return $null
  }

  if (-not (Try-InvokeUiElement -Element $menuButton)) {
    Write-ExtractorLog ("UIA menu button invocation failed for action: {0}" -f $ActionLabel)
    return $null
  }

  Start-Sleep -Milliseconds 350
  if ($script:MenuNavigationIndex.ContainsKey($ActionLabel)) {
    $keyboardResult = Try-ActivateMenuActionByKeyboardNavigation -ActionLabel $ActionLabel -ValidateResult $ValidateResult
    if (-not [string]::IsNullOrWhiteSpace($keyboardResult)) {
      return $keyboardResult
    }

    Write-ExtractorLog ("Keyboard navigation did not resolve menu action: {0}" -f $ActionLabel)
    Send-Keys -Keys '{ESC}' -DelayMs 120
    return $null
  }

  $actionElement = Find-ViewerMenuAction -ArticleWindow $ArticleWindow -Label $ActionLabel
  if ($null -eq $actionElement) {
    Write-ExtractorLog ("UIA menu action not found: {0}" -f $ActionLabel)
    Send-Keys -Keys '{ESC}' -DelayMs 120
    return $null
  }

  $enterResult = Try-ActivateMenuActionWithEnter -Element $actionElement -ValidateResult $ValidateResult
  if (-not [string]::IsNullOrWhiteSpace($enterResult)) {
    return $enterResult
  }

  if (-not (Try-InvokeUiElement -Element $actionElement)) {
    Write-ExtractorLog ("UIA menu action invocation failed: {0}" -f $ActionLabel)
    Send-Keys -Keys '{ESC}' -DelayMs 120
    return $null
  }

  Start-Sleep -Milliseconds 800
  $candidate = & $ValidateResult
  if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
    return [string]$candidate
  }

  Send-Keys -Keys '{ESC}' -DelayMs 120
  return $null
}

function Get-BrowserWindows {
  return @(
    Get-TopLevelWindows |
      Where-Object {
        [string]$_.Current.ClassName -eq 'Chrome_WidgetWin_1' -and
        ([string]$_.Current.Name -match 'Google Chrome|Microsoft Edge|Chrome|Edge')
      }
  )
}

function Get-BrowserSnapshot {
  $snapshot = [ordered]@{}
  foreach ($window in Get-BrowserWindows) {
    $snapshot[[string]$window.Current.NativeWindowHandle] = [string]$window.Current.Name
  }
  return $snapshot
}

function Try-Read-BrowserUrl {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window
  )

  $before = Get-ClipboardTextSafe
  Focus-Window -Window $Window
  Send-Keys -Keys '^l' -DelayMs 180
  Send-Keys -Keys '^c' -DelayMs 280
  $after = Get-ClipboardTextSafe

  if (-not [string]::IsNullOrWhiteSpace($after) -and $after -match '^https?://') {
    return $after
  }

  if ($after -ne $before -and $after -match '^https?://') {
    return $after
  }

  return $null
}

function Try-CopyLinkFromViewerMenu {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ArticleWindow,
    [bool]$RequireMpWeixin
  )

  $validator = {
    $clip = Get-ClipboardTextSafe
    if ([string]::IsNullOrWhiteSpace($clip)) {
      return $null
    }

    if (-not $RequireMpWeixin -or $clip -match '^https://mp\.weixin\.qq\.com/') {
      return $clip
    }

    return $null
  }

  return Try-InvokeMenuActionByUiAutomation -ArticleWindow $ArticleWindow -ActionLabel $script:CopyLinkLabel -ValidateResult $validator
}

function Try-OpenInDefaultBrowser {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ArticleWindow,
    [AllowEmptyString()]
    [string]$ExpectedTitleFragment,
    [bool]$RequireMpWeixin
  )

  $browserSnapshotBefore = Get-BrowserSnapshot
  $validator = {
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while ([DateTime]::UtcNow -lt $deadline) {
      $browserWindows = @(Get-BrowserWindows)
      $changed = @(
        $browserWindows |
          Where-Object {
            $handle = [string]$_.Current.NativeWindowHandle
            $name = [string]$_.Current.Name
            (-not $browserSnapshotBefore.Contains($handle)) -or ($browserSnapshotBefore[$handle] -ne $name)
          }
      )

      if ($changed.Count -gt 0) {
        if (-not [string]::IsNullOrWhiteSpace($ExpectedTitleFragment)) {
          $preferred = @($changed | Where-Object { [string]$_.Current.Name -like "*$ExpectedTitleFragment*" })
          if ($preferred.Count -gt 0) {
            $changed = $preferred + @($changed | Where-Object { $_ -notin $preferred })
          }
        }

        foreach ($candidate in $changed) {
          $url = Try-Read-BrowserUrl -Window $candidate
          if ([string]::IsNullOrWhiteSpace($url)) {
            continue
          }

          if (-not $RequireMpWeixin -or $url -match '^https://mp\.weixin\.qq\.com/') {
            return $url
          }
        }
      }

      Start-Sleep -Milliseconds 300
    }

    return $null
  }

  return Try-InvokeMenuActionByUiAutomation -ArticleWindow $ArticleWindow -ActionLabel $script:OpenInBrowserLabel -ValidateResult $validator
}

function Read-Config {
  $config = [ordered]@{
    viewer_handle = $ViewerHandle
    require_mp_weixin = [bool]$RequireMpWeixin
    allow_browser_fallback = [bool]$AllowBrowserFallback
    expected_title_fragment = $ExpectedTitleFragment
    allow_interactive_viewer_actions = [bool]$AllowInteractiveViewerActions
    log_path = $null
  }

  if (-not [string]::IsNullOrWhiteSpace($InputJsonPath)) {
    $raw = Get-Content -LiteralPath $InputJsonPath -Raw
    $parsed = $raw | ConvertFrom-Json
    $propertyNames = @($parsed.PSObject.Properties.Name)
    if ('viewer_handle' -in $propertyNames -and $null -ne $parsed.viewer_handle) { $config.viewer_handle = [string]$parsed.viewer_handle }
    if ('require_mp_weixin' -in $propertyNames -and $null -ne $parsed.require_mp_weixin) { $config.require_mp_weixin = [bool]$parsed.require_mp_weixin }
    if ('allow_browser_fallback' -in $propertyNames -and $null -ne $parsed.allow_browser_fallback) { $config.allow_browser_fallback = [bool]$parsed.allow_browser_fallback }
    if ('expected_title_fragment' -in $propertyNames -and $null -ne $parsed.expected_title_fragment) { $config.expected_title_fragment = [string]$parsed.expected_title_fragment }
    if ('allow_interactive_viewer_actions' -in $propertyNames -and $null -ne $parsed.allow_interactive_viewer_actions) {
      $config.allow_interactive_viewer_actions = [bool]$parsed.allow_interactive_viewer_actions
    } else {
      $config.allow_interactive_viewer_actions = $true
    }
    if ('log_path' -in $propertyNames -and $null -ne $parsed.log_path) { $config.log_path = [string]$parsed.log_path }
  }

  return [PSCustomObject]$config
}

$config = Read-Config
$script:LogPath = $config.log_path

if (-not $config.allow_interactive_viewer_actions) {
  Write-Output ([PSCustomObject]@{
      status = 'fatal'
      url = $null
      error = 'Interactive viewer actions are disabled by configuration.'
      used_browser_fallback = $false
    })
  return
}

$articleWindow = Get-CurrentArticleWindow -Handle $config.viewer_handle
if ($null -eq $articleWindow) {
  Write-Output ([PSCustomObject]@{
      status = 'fatal'
      url = $null
      error = 'No matching WeChat article viewer window was found.'
      used_browser_fallback = $false
    })
  return
}

Focus-Window -Window $articleWindow
Clear-ClipboardSafe

$url = Try-CopyLinkFromViewerMenu -ArticleWindow $articleWindow -RequireMpWeixin:$config.require_mp_weixin
if (-not [string]::IsNullOrWhiteSpace($url)) {
  Write-Output ([PSCustomObject]@{
      status = 'ok'
      url = $url
      error = $null
      used_browser_fallback = $false
    })
  return
}

if ($config.allow_browser_fallback) {
  Clear-ClipboardSafe
  $url = Try-OpenInDefaultBrowser -ArticleWindow $articleWindow -ExpectedTitleFragment $config.expected_title_fragment -RequireMpWeixin:$config.require_mp_weixin
  if (-not [string]::IsNullOrWhiteSpace($url)) {
    Write-Output ([PSCustomObject]@{
        status = 'ok'
        url = $url
        error = $null
        used_browser_fallback = $true
      })
    return
  }
}

Write-Output ([PSCustomObject]@{
    status = 'no_url'
    url = $null
    error = 'Failed to resolve a real article URL from the current WeChat article viewer.'
    used_browser_fallback = $false
  })
