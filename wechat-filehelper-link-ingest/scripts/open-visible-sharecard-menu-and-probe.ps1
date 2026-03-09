[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WeChatMenuProbeNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@

$script:FileHelperName = ([char]0x6587)+([char]0x4EF6)+([char]0x4F20)+([char]0x8F93)+([char]0x52A9)+([char]0x624B)
$script:LinkPrefix = "[{0}]" -f (([char]0x94FE)+([char]0x63A5))
$script:RunRoot = Join-Path $PSScriptRoot '..\local\runs'

function New-RunContext {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $runDir = Join-Path $script:RunRoot $timestamp
  $artifactDir = Join-Path $runDir 'artifacts'
  New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
  return [PSCustomObject]@{
    Timestamp = $timestamp
    RunDir = $runDir
    ArtifactDir = $artifactDir
    ManifestPath = Join-Path $runDir 'manifest.json'
    ProbePath = Join-Path $artifactDir 'menu-probe.json'
    LogPath = Join-Path $artifactDir 'probe.log'
  }
}

function Write-Log {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Run,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $line = '[{0}] {1}' -f ([DateTimeOffset]::Now.ToString('o')), $Message
  Add-Content -LiteralPath $Run.LogPath -Value $line -Encoding UTF8
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

function Get-WeChatMainWindow {
  $candidates = New-Object System.Collections.Generic.List[object]
  foreach ($window in Get-TopLevelWindows) {
    if ([string]$window.Current.ClassName -ne 'mmui::MainWindow') {
      continue
    }

    $score = 8
    $chatList = $window.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_list'))
    )
    if ($null -ne $chatList) {
      $score += 4
    }

    $candidates.Add([PSCustomObject]@{
      Window = $window
      Score = $score
    }) | Out-Null
  }

  return $candidates | Sort-Object Score -Descending | Select-Object -First 1 -ExpandProperty Window
}

function Get-CurrentChatName {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window
  )

  foreach ($element in Get-Descendants -Root $Window) {
    if ([string]$element.Current.AutomationId -match 'current_chat_name_label') {
      return ([string]$element.Current.Name).Trim()
    }
  }

  return ''
}

function Get-ChatMessageList {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window
  )

  return $Window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_list'))
  )
}

function Get-ChatMessageListItems {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$MessageList
  )

  return @(
    $MessageList.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem))
    )
  )
}

function Get-MessageItemKind {
  param([string]$Name)

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return 'unknown'
  }

  if ($Name -like "视频号*") {
    return 'video'
  }

  if ($Name -like "聊天记录*") {
    return 'chat_record_bundle'
  }

  if ($Name -match [regex]::Escape($script:LinkPrefix)) {
    return 'share_card'
  }

  return 'unknown'
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

  if ([WeChatMenuProbeNative]::IsIconic($handle)) {
    [WeChatMenuProbeNative]::ShowWindowAsync($handle, 9) | Out-Null
    Start-Sleep -Milliseconds 150
  }

  [WeChatMenuProbeNative]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 250
}

function Send-Keys {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Keys,
    [int]$DelayMs = 240
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

  [WeChatMenuProbeNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 60
  [WeChatMenuProbeNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [WeChatMenuProbeNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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

function Get-WeChatViewerWindows {
  $wechatWindowName = ([char]0x5FAE) + ([char]0x4FE1)
  return @(
    Get-TopLevelWindows |
      Where-Object {
        [string]$_.Current.ClassName -eq 'Chrome_WidgetWin_0' -and
        [string]$_.Current.Name -eq $wechatWindowName
      }
  )
}

function Wait-ForNewViewerWindow {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ViewerHandlesBefore,
    [int]$TimeoutSeconds = 8
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $current = @(Get-WeChatViewerWindows)
    foreach ($viewer in $current) {
      $handle = [string]$viewer.Current.NativeWindowHandle
      if ($ViewerHandlesBefore -notcontains $handle) {
        return $viewer
      }
    }
    Start-Sleep -Milliseconds 250
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
        $type = [string]$_.Current.ControlType.ProgrammaticName
        if ($type -notin @('ControlType.Button', 'ControlType.SplitButton', 'ControlType.MenuItem')) {
          return $false
        }

        $rect = $_.Current.BoundingRectangle
        if ($rect.Width -le 0 -or $rect.Height -le 0) {
          return $false
        }

        $name = [string]$_.Current.Name
        $isTopRight = ($rect.Top -lt 220 -and $rect.Left -gt 700)
        $looksLikeMenu = ($name -eq '...' -or $name -eq '.' -or $name -like '*menu*')
        return $isTopRight -or $looksLikeMenu
      }
  )

  return $candidates | Select-Object -First 1
}

function Get-RectangleObject {
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

  return [ordered]@{
    left = [int][Math]::Round($rect.Left, 0)
    top = [int][Math]::Round($rect.Top, 0)
    width = [int][Math]::Round($rect.Width, 0)
    height = [int][Math]::Round($rect.Height, 0)
  }
}

function Get-PatternSupport {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Element
  )

  $invoke = $null
  $selection = $null
  $legacy = $null
  $expandCollapse = $null

  return [ordered]@{
    invoke = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)
    selection_item = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)
    legacy = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacy)
    expand_collapse = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$expandCollapse)
  }
}

$run = New-RunContext
try {
  Write-Log -Run $run -Message 'Starting active menu probe.'
  $mainWindow = Get-WeChatMainWindow
  if ($null -eq $mainWindow) {
    throw 'Could not find an interactive WeChat main window.'
  }

  $chatName = Get-CurrentChatName -Window $mainWindow
  if ($chatName -ne $script:FileHelperName) {
    throw 'Current chat must already be 文件传输助手 before active menu probe.'
  }

  $viewerBefore = @(Get-WeChatViewerWindows | ForEach-Object { [string]$_.Current.NativeWindowHandle })
  if ($viewerBefore.Count -gt 0) {
    throw 'A WeChat article viewer is already open. Close it before the active menu probe.'
  }

  $messageList = Get-ChatMessageList -Window $mainWindow
  if ($null -eq $messageList) {
    throw 'Could not locate chat_message_list.'
  }

  $targetBubble = @(
    Get-ChatMessageListItems -MessageList $messageList |
      Where-Object {
        [string]$_.Current.ClassName -eq 'mmui::ChatBubbleItemView' -and
        (Get-MessageItemKind -Name ([string]$_.Current.Name)) -eq 'share_card'
      } |
      Sort-Object { $_.Current.BoundingRectangle.Top }
  ) | Select-Object -First 1

  if ($null -eq $targetBubble) {
    throw 'No visible share-card bubble was found on the current page.'
  }

  Write-Log -Run $run -Message ("Opening share-card bubble: {0}" -f ([string]$targetBubble.Current.Name).Split("`n")[0])
  $selectionPattern = $null
  if (-not $targetBubble.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
    throw 'Target share-card bubble does not expose SelectionItemPattern.'
  }

  $selectionPattern.Select()
  Start-Sleep -Milliseconds 180
  Focus-Window -Window $mainWindow
  Send-Keys -Keys '{ENTER}' -DelayMs 320

  $viewer = Wait-ForNewViewerWindow -ViewerHandlesBefore $viewerBefore -TimeoutSeconds 8
  if ($null -eq $viewer) {
    throw 'Failed to open a new WeChat article viewer window.'
  }

  Write-Log -Run $run -Message ("Opened viewer handle: {0}" -f [string]$viewer.Current.NativeWindowHandle)
  Focus-Window -Window $viewer
  $menuButton = Find-ViewerMenuButton -ArticleWindow $viewer
  if ($null -eq $menuButton) {
    throw 'Could not find the viewer menu button.'
  }

  if (-not (Try-InvokeUiElement -Element $menuButton)) {
    throw 'Failed to open the viewer menu via UIA.'
  }

  Start-Sleep -Milliseconds 450
  $descendants = @(Get-Descendants -Root $viewer)
  $menuItems = @(
    $descendants |
      Where-Object {
        $rect = Get-RectangleObject -Element $_
        if ($null -eq $rect) {
          return $false
        }

        $type = [string]$_.Current.ControlType.ProgrammaticName
        $name = [string]$_.Current.Name
        $inMenuRegion = ($rect.top -lt 700 -and $rect.left -gt 650)
        $menuishType = $type -in @('ControlType.Menu', 'ControlType.MenuBar', 'ControlType.MenuItem', 'ControlType.Text', 'ControlType.Button')
        return $inMenuRegion -and $menuishType -and -not [string]::IsNullOrWhiteSpace($name)
      } |
      Sort-Object { (Get-RectangleObject -Element $_).top }, { (Get-RectangleObject -Element $_).left }
  )

  $payload = [ordered]@{
    status = 'ok'
    current_chat_name = $chatName
    viewer = [ordered]@{
      handle = [string]$viewer.Current.NativeWindowHandle
      class = [string]$viewer.Current.ClassName
      name = [string]$viewer.Current.Name
    }
    item_count = $menuItems.Count
    items = @(
      $menuItems |
        Select-Object @{
          Name = 'name'
          Expression = { [string]$_.Current.Name }
        }, @{
          Name = 'control_type'
          Expression = { [string]$_.Current.ControlType.ProgrammaticName }
        }, @{
          Name = 'class'
          Expression = { [string]$_.Current.ClassName }
        }, @{
          Name = 'automation_id'
          Expression = { [string]$_.Current.AutomationId }
        }, @{
          Name = 'rectangle'
          Expression = { Get-RectangleObject -Element $_ }
        }, @{
          Name = 'patterns'
          Expression = { Get-PatternSupport -Element $_ }
        }
    )
  }

  $json = $payload | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $run.ProbePath -Value $json -Encoding UTF8
  $manifest = [ordered]@{
    status = 'success'
    probe_path = $run.ProbePath
    artifact_log = $run.LogPath
    viewer_handle = [string]$viewer.Current.NativeWindowHandle
    item_count = $menuItems.Count
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $run.ManifestPath -Encoding UTF8
  $json
} catch {
  $message = $_.Exception.Message
  Write-Log -Run $run -Message ("ERROR: {0}" -f $message)
  $manifest = [ordered]@{
    status = 'failed'
    error = $message
    artifact_log = $run.LogPath
    probe_path = $run.ProbePath
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $run.ManifestPath -Encoding UTF8
  throw
}
