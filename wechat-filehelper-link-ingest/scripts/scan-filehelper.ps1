[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Since,
  [Parameter(Mandatory = $true)]
  [string]$Until,
  [ValidateRange(1, 200)]
  [int]$MaxScrolls = 30,
  [switch]$Reindex,
  [string]$IndexPath,
  [switch]$SkipChatRecordBundles,
  [switch]$SafeSingleArticleMode,
  [switch]$EnableInteractiveArticleOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/common.ps1')

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WeChatNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
'@

$skillRoot = Get-SkillRoot
$run = New-RunContext -CommandName 'scan-filehelper' -SkillRoot $skillRoot
$script:FileHelperName = ([char]0x6587)+([char]0x4EF6)+([char]0x4F20)+([char]0x8F93)+([char]0x52A9)+([char]0x624B)
$script:ChatRecordLabel = ([char]0x804A)+([char]0x5929)+([char]0x8BB0)+([char]0x5F55)
$script:LinkPrefix = '[' + (([char]0x94FE)+([char]0x63A5)) + ']'
$script:VideoMarker = ([char]0x89C6)+([char]0x9891)+([char]0x53F7)
$script:TodayLabel = ([char]0x4ECA)+([char]0x5929)
$script:YesterdayLabel = ([char]0x6628)+([char]0x5929)
$resolvedIndexPath = Get-IndexPath -SkillRoot $skillRoot -IndexPath $IndexPath
$sinceValue = ConvertTo-DateTimeOffsetSafe $Since
$untilValue = ConvertTo-DateTimeOffsetSafe $Until
$logPath = Join-Path $run.ArtifactDir 'scan.log'
$script:UnresolvedReasons = [ordered]@{}
$script:UnresolvedTotal = 0

function Write-ScanLog {
  param([string]$Message)
  $line = '[{0}] {1}' -f ([DateTimeOffset]::Now.ToString('o')), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Add-UnresolvedReason {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Reason,
    [AllowEmptyString()]
    [string]$Detail
  )

  if (-not $script:UnresolvedReasons.Contains($Reason)) {
    $script:UnresolvedReasons[$Reason] = 0
  }

  $script:UnresolvedReasons[$Reason] = [int]$script:UnresolvedReasons[$Reason] + 1
  $script:UnresolvedTotal++

  if (-not [string]::IsNullOrWhiteSpace($Detail)) {
    Write-ScanLog ("Unresolved[{0}]: {1}" -f $Reason, $Detail)
  }
}

function Test-TimestampLikeText {
  param(
    [AllowEmptyString()]
    [string]$Text
  )

  $value = if ($null -eq $Text) { '' } else { [string]$Text }
  return (
    $value -match '^\d{1,2}:\d{2}$' -or
    $value -match '^[^\d\s]{1,4}\s*\d{1,2}:\d{2}$' -or
    $value -match '^\d{1,2}\D\d{1,2}\D\s*\d{1,2}:\d{2}$' -or
    $value -match '^\d{4}\D\d{1,2}\D\d{1,2}\D'
  )
}

function Get-ClusterPrimaryContentLine {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Cluster
  )

  $lines = @(Get-ClusterTextLines -Cluster $Cluster)
  foreach ($line in $lines) {
    if (-not (Test-TimestampLikeText -Text $line)) {
      return $line
    }
  }

  if ($lines.Count -gt 0) {
    return $lines[0]
  }

  return $null
}

function Get-TopLevelWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  return @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
}

function Find-WeChatChatWindow {
  $candidates = New-Object System.Collections.Generic.List[object]
  foreach ($window in Get-TopLevelWindows) {
    $name = [string]$window.Current.Name
    $class = [string]$window.Current.ClassName
    if ($class -ne 'mmui::MainWindow') {
      continue
    }

    $chatPageById = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_page')))
    if ($null -eq $chatPageById) {
      continue
    }

    $score = 8
    $mainTab = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'main_tabbar')))
    if ($null -ne $mainTab) {
      $score += 3
    }

    $chatNameLabel = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'content_view.top_content_view.title_h_view.left_v_view.left_content_v_view.left_ui_.big_title_line_h_view.current_chat_name_label')))
    if ($null -ne $chatNameLabel) {
      $score += 2
    }

    if ($score -gt 0) {
      $candidates.Add([PSCustomObject]@{
        Window = $window
        Score = $score
        Name = $name
        Class = $class
      }) | Out-Null
    }
  }

  return $candidates | Sort-Object Score -Descending | Select-Object -First 1
}

function Focus-AutomationWindow {
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

  if ([WeChatNative]::IsIconic($handle)) {
    [WeChatNative]::ShowWindowAsync($handle, 9) | Out-Null
  } else {
    [WeChatNative]::ShowWindowAsync($handle, 5) | Out-Null
  }

  Start-Sleep -Milliseconds 200
  [WeChatNative]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 300
}

function Send-Keys {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Keys,
    [int]$DelayMs = 350
  )

  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $DelayMs
}

function Get-Descendants {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Root
  )

  return @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
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

  foreach ($element in Get-Descendants -Root $Window) {
    $name = ([string]$element.Current.Name).Trim()
    if ($name -eq $script:FileHelperName) {
      return $name
    }
  }

  return $null
}

function Ensure-FileHelperChat {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window
  )

  $currentName = Get-CurrentChatName -Window $Window
  if ($currentName -eq $script:FileHelperName) {
    Write-ScanLog 'Current chat already equals 文件传输助手.'
    return
  }

  throw 'Current chat must already be 文件传输助手 before scanning. Open that chat manually and rerun.'
}

function Get-ChatPage {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window
  )

  foreach ($element in Get-Descendants -Root $Window) {
    if ([string]$element.Current.AutomationId -eq 'chat_message_page' -or [string]$element.Current.ClassName -eq 'mmui::ChatMessagePage') {
      return $element
    }
  }

  throw 'Could not locate the WeChat chat message page.'
}

function Get-ChatMessageList {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window
  )

  $list = $Window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_list'))
  )
  if ($null -ne $list) {
    return $list
  }

  throw 'Could not locate the WeChat chat message list.'
}

function Get-ElementRectangle {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Element
  )

  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) {
    return $null
  }

  return [PSCustomObject]@{
    Left = [math]::Round($rect.Left, 0)
    Top = [math]::Round($rect.Top, 0)
    Width = [math]::Round($rect.Width, 0)
    Height = [math]::Round($rect.Height, 0)
  }
}

function Get-ChatMessageListItems {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$MessageList
  )

  $items = New-Object System.Collections.Generic.List[object]
  $children = @($MessageList.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
  foreach ($element in $children) {
    $name = ([string]$element.Current.Name).Trim()
    $id = [string]$element.Current.AutomationId
    $class = [string]$element.Current.ClassName
    $type = [string]$element.Current.ControlType.ProgrammaticName
    $rect = Get-ElementRectangle -Element $element
    if ($null -eq $rect) {
      continue
    }

    if ($class -notin @('mmui::ChatBubbleItemView', 'mmui::ChatItemView')) {
      continue
    }

    $items.Add([PSCustomObject]@{
        Element = $element
        Name = $name
        AutomationId = $id
        ClassName = $class
        ControlType = $type
        Left = $rect.Left
        Top = $rect.Top
        Width = $rect.Width
        Height = $rect.Height
      }) | Out-Null
  }

  return @($items.ToArray() | Sort-Object Top, Left)
}

function New-SyntheticClusterFromMessageItem {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Item
  )

  $elements = New-Object System.Collections.Generic.List[object]
  $elements.Add([PSCustomObject]@{
    Element = $Item.Element
    Name = $Item.Name
    AutomationId = $Item.AutomationId
    ClassName = $Item.ClassName
    ControlType = $Item.ControlType
    Left = $Item.Left
    Top = $Item.Top
    Width = $Item.Width
    Height = $Item.Height
  }) | Out-Null

  return [PSCustomObject]@{
    TopAnchor = $Item.Top
    Bottom = $Item.Top + $Item.Height
    Elements = $elements
  }
}

function Get-ClusterTextLines {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Cluster
  )

  return @(
    $Cluster.Elements |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_.Name) } |
      Sort-Object Top, Left |
      ForEach-Object { $_.Name.Trim() } |
      Select-Object -Unique
  )
}

function Invoke-DoubleClickAt {
  param(
    [int]$X,
    [int]$Y
  )

  [WeChatNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 80
  [WeChatNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [WeChatNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [WeChatNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [WeChatNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-ClickAt {
  param(
    [int]$X,
    [int]$Y
  )

  [WeChatNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 60
  [WeChatNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [WeChatNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Get-ElementCenterPoint {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Element
  )

  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) {
    return $null
  }

  return [PSCustomObject]@{
    X = [int][Math]::Round($rect.Left + ($rect.Width / 2.0), 0)
    Y = [int][Math]::Round($rect.Top + ($rect.Height / 2.0), 0)
  }
}

function Try-ActivateUiElement {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element,
    [switch]$DoubleClick
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

  $selectionPattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
      $selectionPattern.Select()
      Start-Sleep -Milliseconds 150
    }
  } catch {
  }

  try {
    $clickPoint = $Element.GetClickablePoint()
    $x = [int][Math]::Round($clickPoint.X, 0)
    $y = [int][Math]::Round($clickPoint.Y, 0)
    if ($DoubleClick) {
      Invoke-DoubleClickAt -X $x -Y $y
    } else {
      Invoke-ClickAt -X $x -Y $y
    }
    return $true
  } catch {
  }

  $centerPoint = Get-ElementCenterPoint -Element $Element
  if ($null -eq $centerPoint) {
    return $false
  }

  if ($DoubleClick) {
    Invoke-DoubleClickAt -X $centerPoint.X -Y $centerPoint.Y
  } else {
    Invoke-ClickAt -X $centerPoint.X -Y $centerPoint.Y
  }

  return $true
}

function Try-ActivateUiElementMode {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element,
    [Parameter(Mandatory = $true)]
    [ValidateSet('invoke', 'click', 'double')]
    [string]$Mode
  )

  if ($null -eq $Element) {
    return $false
  }

  if ($Mode -eq 'invoke') {
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

    return $false
  }

  $selectionPattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
      $selectionPattern.Select()
      Start-Sleep -Milliseconds 150
    }
  } catch {
  }

  try {
    $clickPoint = $Element.GetClickablePoint()
    if ($Mode -eq 'double') {
      Invoke-DoubleClickAt -X ([int][Math]::Round($clickPoint.X, 0)) -Y ([int][Math]::Round($clickPoint.Y, 0))
    } else {
      Invoke-ClickAt -X ([int][Math]::Round($clickPoint.X, 0)) -Y ([int][Math]::Round($clickPoint.Y, 0))
    }
    Start-Sleep -Milliseconds 250
    return $true
  } catch {
  }

  $centerPoint = Get-ElementCenterPoint -Element $Element
  if ($null -eq $centerPoint) {
    return $false
  }

  if ($Mode -eq 'double') {
    Invoke-DoubleClickAt -X $centerPoint.X -Y $centerPoint.Y
  } else {
    Invoke-ClickAt -X $centerPoint.X -Y $centerPoint.Y
  }
  Start-Sleep -Milliseconds 250
  return $true
}

function Try-ActivateBundleBubble {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element
  )

  if ($null -eq $Element) {
    return $false
  }

  foreach ($mode in @('click', 'invoke', 'double')) {
    if (Try-ActivateUiElementMode -Element $Element -Mode $mode) {
      return $true
    }
  }

  return $false
}

function Try-ActivateShareCardBubble {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow
  )

  if ($null -eq $Element) {
    return $false
  }

  $selectionPattern = $null
  $selected = $false
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
      $selectionPattern.Select()
      $selected = $true
      Start-Sleep -Milliseconds 150
    }
  } catch {
  }

  if ($selected) {
    try {
      $Element.SetFocus()
      Start-Sleep -Milliseconds 100
    } catch {
    }

    Focus-AutomationWindow -Window $WeChatWindow
    Send-Keys -Keys '{ENTER}' -DelayMs 300
    return $true
  }

  foreach ($mode in @('invoke', 'click', 'double')) {
    if (Try-ActivateUiElementMode -Element $Element -Mode $mode) {
      return $true
    }
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

function Get-WeChatViewerHandleSet {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($window in Get-WeChatViewerWindows) {
    $handle = [string]$window.Current.NativeWindowHandle
    if (-not [string]::IsNullOrWhiteSpace($handle)) {
      $set.Add($handle) | Out-Null
    }
  }
  return $set
}

function Get-WeChatViewerByHandle {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Handle
  )

  foreach ($window in Get-WeChatViewerWindows) {
    if ([string]$window.Current.NativeWindowHandle -eq $Handle) {
      return $window
    }
  }

  return $null
}

function Get-WeChatViewerContentHash {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Window
  )

  if ($null -eq $Window) {
    return $null
  }

  $handle = [IntPtr]$Window.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero) {
    return $null
  }

  $rect = New-Object WeChatNative+RECT
  [WeChatNative]::GetWindowRect($handle, [ref]$rect) | Out-Null
  $width = [int](($rect.Right - $rect.Left) * 0.73)
  $height = [int]($rect.Bottom - $rect.Top)
  if ($width -le 0 -or $height -le 0) {
    return $null
  }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $memoryStream = New-Object System.IO.MemoryStream
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $memoryStream.ToArray()
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
      return ([System.BitConverter]::ToString($md5.ComputeHash($bytes))).Replace('-', '')
    } finally {
      $md5.Dispose()
    }
  } finally {
    $memoryStream.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Close-WeChatViewerWindow {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Window
  )

  if ($null -eq $Window) {
    return
  }

  Focus-AutomationWindow -Window $Window
  Send-Keys -Keys '^w' -DelayMs 300
}

function Get-ClipboardTextSafe {
  try {
    return [System.Windows.Forms.Clipboard]::GetText()
  } catch {
    return $null
  }
}

function Get-RecordDetailWindow {
  foreach ($window in Get-TopLevelWindows) {
    if ([string]$window.Current.ClassName -eq 'mmui::RecordDetailWindow') {
      return $window
    }
  }

  return $null
}

function Close-RecordDetailWindow {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Window
  )

  if ($null -eq $Window) {
    return
  }

  $closeButton = $Window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '关闭'))
  )

  if ($null -ne $closeButton) {
    $pattern = $null
    if ($closeButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $pattern.Invoke()
      Start-Sleep -Milliseconds 400
      return
    }
  }

  Focus-AutomationWindow -Window $Window
  Send-Keys -Keys '%{F4}' -DelayMs 450
}

function New-LinkRecord {
  param(
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$MessageTime,
    [Parameter(Mandatory = $true)]
    [string]$MessageType,
    [Parameter(Mandatory = $true)]
    [string]$Title,
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [Parameter(Mandatory = $true)]
    [string]$SourceText,
    [Parameter(Mandatory = $true)]
    [string]$SessionId
  )

  $canonical = ConvertTo-CanonicalUrl -Url $Url
  if ([string]::IsNullOrWhiteSpace($canonical)) {
    return $null
  }

  return [PSCustomObject]@{
    captured_at = [DateTimeOffset]::Now.ToString('o')
    message_time = $MessageTime.ToString('o')
    chat_name = $script:FileHelperName
    message_type = $MessageType
    title = $Title
    url = $canonical
    source_text = $SourceText
    dedupe_key = New-DedupeKey -ChatName $script:FileHelperName -MessageTime $MessageTime.ToString('o') -CanonicalUrl $canonical -Title $Title
    capture_session_id = $SessionId
  }
}

function Get-TitleFragment {
  param(
    [AllowEmptyString()]
    [string]$Text
  )

  $value = [string]$Text
  $value = $value -replace ('^' + [regex]::Escape($script:LinkPrefix)), ''
  $value = ($value -split '\r?\n')[0]
  $value = $value.Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }

  $limit = [Math]::Min(14, $value.Length)
  return $value.Substring(0, $limit)
}

function Get-MessageItemKind {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Item
  )

  $name = [string]$Item.Name
  if ([string]::IsNullOrWhiteSpace($name)) {
    return 'unknown'
  }

  if ($name -like "*$($script:VideoMarker)*") {
    return 'video'
  }

  if ($name -match 'https?://') {
    return 'text_url'
  }

  if ($name -match ('^' + [regex]::Escape($script:ChatRecordLabel)) -and $name -match [regex]::Escape($script:LinkPrefix)) {
    return 'chat_record_bundle'
  }

  if ($name -match [regex]::Escape($script:LinkPrefix)) {
    return 'share_card'
  }

  return 'unknown'
}

function Invoke-CurrentArticleExtractor {
  param(
    [AllowNull()]
    [string]$ExpectedTitleFragment,
    [switch]$SafeMode,
    [switch]$AllowInteractiveViewerActions
  )

  $extractScript = Join-Path $PSScriptRoot 'extract-current-article-link.ps1'
  $argumentList = @(
    '-ExecutionPolicy', 'Bypass',
    '-File', $extractScript
  )

  if (-not [string]::IsNullOrWhiteSpace($ExpectedTitleFragment)) {
    $argumentList += @('-ExpectedTitleFragment', $ExpectedTitleFragment)
  }

  if ($SafeMode) {
    $argumentList += '-SafeMode'
  }

  if ($AllowInteractiveViewerActions) {
    $argumentList += '-AllowInteractiveViewerActions'
  }

  $stdoutPath = Join-Path $run.ArtifactDir ('extract-{0}-stdout.log' -f ([guid]::NewGuid().ToString('N')))
  $stderrPath = Join-Path $run.ArtifactDir ('extract-{0}-stderr.log' -f ([guid]::NewGuid().ToString('N')))
  try {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    if ($process.ExitCode -ne 0) {
      $stderr = ''
      if (Test-Path -LiteralPath $stderrPath) {
        $stderr = (Get-Content -LiteralPath $stderrPath -Raw).Trim()
      }

      if (-not [string]::IsNullOrWhiteSpace($stderr)) {
        Write-ScanLog ("Article extractor failed: {0}" -f $stderr)
      } else {
        Write-ScanLog ("Article extractor exited with code {0}." -f $process.ExitCode)
      }
      return $null
    }

    if (-not (Test-Path -LiteralPath $stdoutPath)) {
      return $null
    }

    $output = @(Get-Content -LiteralPath $stdoutPath)
    if ($output.Count -eq 0) {
      return $null
    }

    return ($output | Select-Object -Last 1)
  } finally {
    Remove-Item -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrPath -ErrorAction SilentlyContinue
  }
}

function Try-OpenChatRecordDetailWindow {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Cluster,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow
  )

  $candidate = $Cluster.Elements |
    Where-Object { $_.ClassName -eq 'mmui::ChatBubbleItemView' } |
    Sort-Object Width -Descending |
    Select-Object -First 1

  if ($null -eq $candidate) {
    Add-UnresolvedReason -Reason 'bundle_missing_bubble' -Detail 'Chat-record bundle cluster had no clickable bubble element.'
    return $null
  }

  Focus-AutomationWindow -Window $WeChatWindow
  $activated = $false
  foreach ($mode in @('click', 'invoke', 'double')) {
    if (-not (Try-ActivateUiElementMode -Element $candidate.Element -Mode $mode)) {
      continue
    }

    $activated = $true

    $deadline = (Get-Date).AddSeconds(2)
    while ((Get-Date) -lt $deadline) {
      $detailWindow = Get-RecordDetailWindow
      if ($null -ne $detailWindow) {
        return $detailWindow
      }
      Start-Sleep -Milliseconds 200
    }
  }

  if (-not $activated) {
    Write-ScanLog 'Bundle bubble could not be activated.'
    Add-UnresolvedReason -Reason 'bundle_not_activatable' -Detail 'Chat-record bundle bubble did not respond to click/invoke/double-click activation.'
  }
  return $null
}

function Get-ChatRecordDetailItems {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$DetailWindow
  )

  $items = New-Object System.Collections.Generic.List[object]
  foreach ($element in Get-Descendants -Root $DetailWindow) {
    $name = ([string]$element.Current.Name).Trim()
    if ([string]$element.Current.ClassName -ne 'mmui::ChatBubbleItemView') {
      continue
    }
    if ($name -notmatch ('^' + [regex]::Escape($script:LinkPrefix))) {
      continue
    }
    if ($name -like "*$($script:VideoMarker)*") {
      Add-UnresolvedReason -Reason 'video_item_skipped' -Detail ("Skipped video detail item: {0}" -f $name)
      continue
    }

    $rect = Get-ElementRectangle -Element $element
    if ($null -eq $rect) {
      continue
    }

    $items.Add([PSCustomObject]@{
      Element = $element
      Name = $name
      Left = $rect.Left
      Top = $rect.Top
      Width = $rect.Width
      Height = $rect.Height
    }) | Out-Null
  }

  return @($items.ToArray() | Sort-Object Top, Left)
}

function Try-CaptureChatRecordItemUrl {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$DetailWindow,
    [Parameter(Mandatory = $true)]
    [psobject]$Item
  )

  $titleFragment = Get-TitleFragment -Text $Item.Name
  $beforeViewer = @(Get-WeChatViewerWindows | Select-Object -First 1)
  $beforeViewerWindow = if ($beforeViewer.Count -gt 0) { $beforeViewer[0] } else { $null }
  $beforeHash = Get-WeChatViewerContentHash -Window $beforeViewerWindow
  Focus-AutomationWindow -Window $DetailWindow
  if (-not (Try-ActivateUiElement -Element $Item.Element)) {
    Add-UnresolvedReason -Reason 'detail_item_not_activatable' -Detail ("Chat-record detail item could not be activated: {0}" -f $Item.Name)
    return $null
  }
  Start-Sleep -Milliseconds 1200

  $afterViewer = @(Get-WeChatViewerWindows | Select-Object -First 1)
  $afterViewerWindow = if ($afterViewer.Count -gt 0) { $afterViewer[0] } else { $null }
  $afterHash = Get-WeChatViewerContentHash -Window $afterViewerWindow
  $viewerChanged = $false
  if ($null -ne $afterViewerWindow) {
    if ($null -eq $beforeViewerWindow) {
      $viewerChanged = $true
    } elseif ([string]$beforeViewerWindow.Current.NativeWindowHandle -ne [string]$afterViewerWindow.Current.NativeWindowHandle) {
      $viewerChanged = $true
    } elseif (-not [string]::IsNullOrWhiteSpace($afterHash) -and $beforeHash -ne $afterHash) {
      $viewerChanged = $true
    }
  }

  if (-not $viewerChanged) {
    Write-ScanLog ("Detail item click did not switch the viewer: {0}" -f $Item.Name)
    Add-UnresolvedReason -Reason 'detail_item_viewer_not_changed' -Detail ("Chat-record detail item did not switch the viewer: {0}" -f $Item.Name)
    return $null
  }

  $capturedUrl = Invoke-CurrentArticleExtractor -ExpectedTitleFragment $titleFragment
  if (-not [string]::IsNullOrWhiteSpace($capturedUrl)) {
    return $capturedUrl
  }

  Add-UnresolvedReason -Reason 'detail_item_unresolved' -Detail ("Failed to resolve bundle detail item: {0}" -f $Item.Name)
  return $null
}

function Try-CaptureChatRecordBundleRecords {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Cluster,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$MessageTime,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [Parameter(Mandatory = $true)]
    [string]$SessionId
  )

  $detailWindow = Try-OpenChatRecordDetailWindow -Cluster $Cluster -WeChatWindow $WeChatWindow
  if ($null -eq $detailWindow) {
    Write-ScanLog 'Chat record bundle did not open a detail window.'
    Add-UnresolvedReason -Reason 'bundle_detail_not_opened' -Detail 'Chat-record bundle did not open a detail window.'
    return @()
  }

  try {
    $detailItems = @(Get-ChatRecordDetailItems -DetailWindow $detailWindow)
    if ($detailItems.Count -eq 0) {
      Write-ScanLog 'Chat record detail window opened but no link items were found.'
      Add-UnresolvedReason -Reason 'bundle_no_link_items' -Detail 'Chat-record bundle detail window had no non-video link items.'
      return @()
    }

    $records = New-Object System.Collections.Generic.List[object]
    foreach ($detailItem in $detailItems) {
      $url = Try-CaptureChatRecordItemUrl -DetailWindow $detailWindow -Item $detailItem
      if ([string]::IsNullOrWhiteSpace($url)) {
        Write-ScanLog ("Failed to capture URL for detail item: {0}" -f $detailItem.Name)
        continue
      }

      $title = Get-TitleFragment -Text $detailItem.Name
      $record = New-LinkRecord -MessageTime $MessageTime -MessageType 'chat_record_bundle' -Title $title -Url $url -SourceText $detailItem.Name -SessionId $SessionId
      if ($null -ne $record) {
        $records.Add($record) | Out-Null
      }
    }

    return @($records.ToArray())
  } finally {
    Close-RecordDetailWindow -Window $detailWindow
    Focus-AutomationWindow -Window $WeChatWindow
  }
}

function Try-CaptureChatRecordBundleRecordsFromBubble {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$BubbleElement,
    [Parameter(Mandatory = $true)]
    [string]$BubbleName,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$MessageTime,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [Parameter(Mandatory = $true)]
    [string]$SessionId
  )

  $cluster = [PSCustomObject]@{
    TopAnchor = 0
    Bottom = 0
    Elements = @(
      [PSCustomObject]@{
        Element = $BubbleElement
        Name = $BubbleName
        AutomationId = ''
        ClassName = 'mmui::ChatBubbleItemView'
        ControlType = ''
        Left = 0
        Top = 0
        Width = 0
        Height = 0
      }
    )
  }

  return @(Try-CaptureChatRecordBundleRecords -Cluster $cluster -MessageTime $MessageTime -WeChatWindow $WeChatWindow -SessionId $SessionId)
}

function Try-CaptureShareCardUrlFromBubble {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$BubbleElement,
    [AllowEmptyString()]
    [string]$BubbleName,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [switch]$SafeMode,
    [switch]$AllowInteractiveViewerActions
  )

  $titleFragment = Get-TitleFragment -Text $BubbleName
  $url = $null
  $newViewerHandle = $null
  $viewerChanged = $false
  $activated = $false

  $beforeViewerWindow = @(Get-WeChatViewerWindows | Select-Object -First 1)
  $beforeViewer = if ($beforeViewerWindow.Count -gt 0) { $beforeViewerWindow[0] } else { $null }
  $beforeHash = Get-WeChatViewerContentHash -Window $beforeViewer
  $viewerHandlesBefore = Get-WeChatViewerHandleSet

  Focus-AutomationWindow -Window $WeChatWindow
  if (Try-ActivateShareCardBubble -Element $BubbleElement -WeChatWindow $WeChatWindow) {
    $activated = $true
    Start-Sleep -Seconds 2

    $viewerHandlesAfter = Get-WeChatViewerHandleSet
    $newViewerHandle = $null
    foreach ($handle in @($viewerHandlesAfter)) {
      if ($null -ne $viewerHandlesBefore -and -not $viewerHandlesBefore.Contains($handle)) {
        $newViewerHandle = $handle
        break
      }
    }

    $afterViewerWindow = @(Get-WeChatViewerWindows | Select-Object -First 1)
    $afterViewer = if ($afterViewerWindow.Count -gt 0) { $afterViewerWindow[0] } else { $null }
    $afterHash = Get-WeChatViewerContentHash -Window $afterViewer
    $viewerChanged = $false
    if (-not [string]::IsNullOrWhiteSpace($newViewerHandle)) {
      $viewerChanged = $true
    } elseif ($null -ne $afterViewer) {
      if ($null -eq $beforeViewer) {
        $viewerChanged = $true
      } elseif ([string]$beforeViewer.Current.NativeWindowHandle -ne [string]$afterViewer.Current.NativeWindowHandle) {
        $viewerChanged = $true
      } elseif (-not [string]::IsNullOrWhiteSpace($afterHash) -and $beforeHash -ne $afterHash) {
        $viewerChanged = $true
      }
    }
  }

  if (-not $activated) {
    Add-UnresolvedReason -Reason 'share_card_not_activatable' -Detail 'Share-card bubble did not respond to selection-plus-enter or fallback activation.'
    return $null
  }

  if (-not $viewerChanged) {
    Write-ScanLog 'Share card fallback did not confirm a viewer change; skipping URL capture.'
    Add-UnresolvedReason -Reason 'share_card_viewer_not_changed' -Detail 'Share-card click did not open or switch the WeChat article viewer.'
    Focus-AutomationWindow -Window $WeChatWindow
    return $null
  }

  $url = Invoke-CurrentArticleExtractor -ExpectedTitleFragment $titleFragment -SafeMode:$SafeMode -AllowInteractiveViewerActions:$AllowInteractiveViewerActions
  if (-not [string]::IsNullOrWhiteSpace($url)) {
    Write-ScanLog ("Captured share card URL via article extractor: {0}" -f $url)
  } else {
    Write-ScanLog 'Share card fallback confirmed a viewer change but article extractor did not return a URL.'
    Add-UnresolvedReason -Reason 'share_card_extractor_failed' -Detail 'Share-card viewer opened but the article extractor did not return a real URL.'
  }

  if (-not $SafeMode -and -not [string]::IsNullOrWhiteSpace($newViewerHandle)) {
    Close-WeChatViewerWindow -Window (Get-WeChatViewerByHandle -Handle $newViewerHandle)
  }
  Focus-AutomationWindow -Window $WeChatWindow

  return $url
}

function Try-CaptureShareCardUrl {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Cluster,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow
  )

  try {
    $candidate = $Cluster.Elements |
      Where-Object { $_.ClassName -eq 'mmui::ChatBubbleItemView' } |
      Sort-Object Width -Descending |
      Select-Object -First 1
    if ($null -eq $candidate -or $null -eq $candidate.Element) {
      Add-UnresolvedReason -Reason 'share_card_missing_bubble' -Detail 'Share-card cluster had no clickable bubble element.'
      return $null
    }

    return (Try-CaptureShareCardUrlFromBubble -BubbleElement $candidate.Element -BubbleName (Get-ClusterPrimaryContentLine -Cluster $Cluster) -WeChatWindow $WeChatWindow)
  } catch {
    Write-ScanLog ("Share card capture error: {0}" -f $_.Exception.Message)
    Add-UnresolvedReason -Reason 'share_card_runtime_error' -Detail $_.Exception.Message
    Focus-AutomationWindow -Window $WeChatWindow
    return $null
  }
}

function Resolve-ClusterMessageTime {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Cluster,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$FallbackCaptureTime,
    [AllowNull()]
    [DateTimeOffset]$CurrentDayAnchor
  )

  $lines = @(Get-ClusterTextLines -Cluster $Cluster)
  if ($lines.Count -eq 0) {
    return $(if ($null -ne $CurrentDayAnchor) { $CurrentDayAnchor } else { $FallbackCaptureTime })
  }

  $timestampLine = $lines | Where-Object { Test-TimestampLikeText -Text $_ } | Select-Object -First 1
  if ($null -eq $timestampLine -and $null -ne $CurrentDayAnchor) {
    return $CurrentDayAnchor
  }
  $timestampText = if ($null -eq $timestampLine) { '' } else { [string]$timestampLine }
  return Resolve-WeChatTimestamp -RawText $timestampText -Fallback $FallbackCaptureTime -CurrentDayAnchor $CurrentDayAnchor
}

function Convert-MessageItemToRecords {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Item,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$MessageTime,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [Parameter(Mandatory = $true)]
    [string]$SessionId
  )

  $kind = Get-MessageItemKind -Item $Item
  $sourceText = ([string]$Item.Name).Trim()
  if ([string]::IsNullOrWhiteSpace($sourceText)) {
    return @()
  }

  if ($kind -eq 'video') {
    Add-UnresolvedReason -Reason 'video_message_skipped' -Detail ("Skipped non-text video-like message: {0}" -f $sourceText)
    return @()
  }

  if ($kind -eq 'chat_record_bundle') {
    if (-not $EnableInteractiveArticleOpen) {
      Add-UnresolvedReason -Reason 'bundle_skipped_interactive_disabled' -Detail ("Skipped chat-record bundle because interactive article opening is disabled: {0}" -f (Get-TitleFragment -Text $sourceText))
      return @()
    }

    if ($SkipChatRecordBundles -or $SafeSingleArticleMode) {
      Add-UnresolvedReason -Reason 'bundle_skipped_by_mode' -Detail ("Skipped chat-record bundle due to active scan mode: {0}" -f (Get-TitleFragment -Text $sourceText))
      return @()
    }
    return @(Try-CaptureChatRecordBundleRecordsFromBubble -BubbleElement $Item.Element -BubbleName $sourceText -MessageTime $MessageTime -WeChatWindow $WeChatWindow -SessionId $SessionId)
  }

  $urls = @()
  $messageType = 'share_card'
  $title = $sourceText

  if ($kind -eq 'text_url') {
    $urls = @(Get-UrlMatchesFromText -Text $sourceText)
    $messageType = 'text_url'
  } elseif ($kind -eq 'share_card') {
    if (-not $EnableInteractiveArticleOpen) {
      Add-UnresolvedReason -Reason 'share_card_skipped_interactive_disabled' -Detail ("Skipped share card because interactive article opening is disabled: {0}" -f (Get-TitleFragment -Text $sourceText))
      return @()
    }

    $capturedUrl = Try-CaptureShareCardUrlFromBubble -BubbleElement $Item.Element -BubbleName $sourceText -WeChatWindow $WeChatWindow -SafeMode:$SafeSingleArticleMode -AllowInteractiveViewerActions:$EnableInteractiveArticleOpen
    if (-not [string]::IsNullOrWhiteSpace($capturedUrl)) {
      $urls = @($capturedUrl)
    }
    $title = Get-TitleFragment -Text $sourceText
  } else {
    $fallbackUrls = @(Get-UrlMatchesFromText -Text $sourceText)
    if ($fallbackUrls.Count -gt 0) {
      $urls = $fallbackUrls
      $messageType = 'text_url'
    } else {
      return @()
    }
  }

  if ([string]::IsNullOrWhiteSpace([string]$title)) {
    $title = $sourceText
  }

  if ($urls.Count -eq 0) {
    return @()
  }

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($url in $urls) {
    $record = New-LinkRecord -MessageTime $MessageTime -MessageType $messageType -Title $title -Url $url -SourceText $sourceText -SessionId $SessionId
    if ($null -ne $record) {
      $records.Add($record) | Out-Null
    }
  }

  return @($records.ToArray())
}

function Convert-ClusterToRecord {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Cluster,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$FallbackCaptureTime,
    [AllowNull()]
    [DateTimeOffset]$CurrentDayAnchor,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [Parameter(Mandatory = $true)]
    [string]$SessionId
  )

  $lines = @(Get-ClusterTextLines -Cluster $Cluster)
  if ($lines.Count -eq 0) {
    return @()
  }

  $messageTime = Resolve-ClusterMessageTime -Cluster $Cluster -FallbackCaptureTime $FallbackCaptureTime -CurrentDayAnchor $CurrentDayAnchor
  $joined = ($lines -join ' ')
  $urls = @(Get-UrlMatchesFromText -Text $joined)
  $primaryLine = Get-ClusterPrimaryContentLine -Cluster $Cluster
  $isBundle = (($lines | Where-Object { $_ -match ('^' + [regex]::Escape($script:ChatRecordLabel)) } | Measure-Object).Count -gt 0) -and ($joined -match [regex]::Escape($script:LinkPrefix))

  $messageType = 'share_card'
  $title = if ([string]::IsNullOrWhiteSpace([string]$primaryLine)) { $lines[0] } else { $primaryLine }
  $sourceText = ($lines -join [Environment]::NewLine)

  if ($isBundle) {
    $bundleRecords = @(Try-CaptureChatRecordBundleRecords -Cluster $Cluster -MessageTime $messageTime -WeChatWindow $WeChatWindow -SessionId $SessionId)
    return $bundleRecords
  }

  if ($urls.Count -gt 0) {
    $messageType = 'text_url'
    $title = if ($lines.Count -gt 1 -and (Test-TimestampLikeText -Text $lines[0])) { $lines[1] } else { $title }
  } else {
    if ($joined -like "*$($script:VideoMarker)*") {
      Add-UnresolvedReason -Reason 'video_message_skipped' -Detail ("Skipped non-text video-like message: {0}" -f $title)
      return @()
    }
    $urlFromFallback = Try-CaptureShareCardUrl -Cluster $Cluster -WeChatWindow $WeChatWindow
    if (-not [string]::IsNullOrWhiteSpace($urlFromFallback)) {
      $urls = @($urlFromFallback)
    }
  }

  if ($urls.Count -eq 0) {
    return @()
  }

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($url in $urls) {
    $record = New-LinkRecord -MessageTime $messageTime -MessageType $messageType -Title $title -Url $url -SourceText $sourceText -SessionId $SessionId
    if ($null -eq $record) {
      continue
    }
    $records.Add($record) | Out-Null
  }

  return @($records.ToArray())
}

function Scroll-ChatHistory {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ChatPage
  )

  try {
    $ChatPage.SetFocus()
  } catch {
  }

  Send-Keys -Keys '{PGUP}' -DelayMs 650
}

try {
  if ($sinceValue -gt $untilValue) {
    throw '-Since must be earlier than or equal to -Until.'
  }

  Write-ScanLog ("Starting scan with Since={0}, Until={1}, MaxScrolls={2}, Reindex={3}" -f $sinceValue.ToString('o'), $untilValue.ToString('o'), $MaxScrolls, [bool]$Reindex)

  $windowCandidate = Find-WeChatChatWindow
  if ($null -eq $windowCandidate) {
    throw 'Could not find an interactive WeChat main chat window. Bring WeChat conversations to the foreground and rerun.'
  }

  $wechatWindow = $windowCandidate.Window
  Focus-AutomationWindow -Window $wechatWindow
  Ensure-FileHelperChat -Window $wechatWindow
  $chatPage = Get-ChatPage -Window $wechatWindow
  $chatMessageList = Get-ChatMessageList -Window $wechatWindow

  $currentDayAnchor = $null
  $captureRecords = New-Object System.Collections.Generic.List[object]
  $seenMessageFingerprints = New-Object 'System.Collections.Generic.HashSet[string]'
  $noProgressScrolls = 0
  $forceAnchorRecoveryScroll = $false

  for ($scrollIndex = 0; $scrollIndex -lt $MaxScrolls; $scrollIndex++) {
    Write-ScanLog ("Collecting visible message items at scroll {0}" -f $scrollIndex)
    $messageItems = @(Get-ChatMessageListItems -MessageList $chatMessageList)
    $visibleOldestTime = $null
    $newFingerprintCount = 0
    $pageAnchor = $null
    $pendingWithoutAnchor = 0

    foreach ($item in $messageItems) {
      if ([string]$item.ClassName -eq 'mmui::ChatItemView') {
        if ([string]::IsNullOrWhiteSpace($item.Name) -or -not (Test-TimestampLikeText -Text $item.Name)) {
          continue
        }

        $pageAnchor = Resolve-WeChatTimestamp -RawText $item.Name -Fallback $untilValue -CurrentDayAnchor $currentDayAnchor
        $currentDayAnchor = $pageAnchor
        $timeFingerprint = "time|$($pageAnchor.ToString('o'))|$($item.Name)"
        if ($seenMessageFingerprints.Add($timeFingerprint)) {
          $newFingerprintCount++
        }
        if ($null -eq $visibleOldestTime -or $pageAnchor -lt $visibleOldestTime) {
          $visibleOldestTime = $pageAnchor
        }
        continue
      }

      if ([string]$item.ClassName -ne 'mmui::ChatBubbleItemView') {
        continue
      }

      if ($null -eq $pageAnchor) {
        $pendingWithoutAnchor++
        continue
      }

      $messageFingerprint = "bubble|$($pageAnchor.ToString('o'))|$($item.Name)"
      if (-not $seenMessageFingerprints.Add($messageFingerprint)) {
        continue
      }
      $newFingerprintCount++

      if ($null -eq $visibleOldestTime -or $pageAnchor -lt $visibleOldestTime) {
        $visibleOldestTime = $pageAnchor
      }

      $records = @(Convert-MessageItemToRecords -Item $item -MessageTime $pageAnchor -WeChatWindow $wechatWindow -SessionId $run.SessionId)
      foreach ($record in $records) {
        if ($null -eq $record) {
          continue
        }
        if ($record.PSObject.Properties.Name -notcontains 'message_time') {
          Write-ScanLog ("Skipping unexpected non-record output from Convert-MessageItemToRecords: {0}" -f $record.GetType().FullName)
          continue
        }
        $when = ConvertTo-DateTimeOffsetSafe $record.message_time
        if ($when -lt $sinceValue) {
          continue
        }
        if ($when -gt $untilValue) {
          continue
        }
        $captureRecords.Add($record) | Out-Null
      }
    }

    if ($pendingWithoutAnchor -gt 0) {
      Write-ScanLog ("Skipped {0} top-of-page bubble(s) without a visible time anchor on this scroll." -f $pendingWithoutAnchor)
    }

    if ($newFingerprintCount -eq 0) {
      $noProgressScrolls++
      Write-ScanLog ("No new visible message items were discovered at scroll {0}." -f $scrollIndex)
    } else {
      $noProgressScrolls = 0
    }

    if ($null -ne $visibleOldestTime -and $visibleOldestTime -le $sinceValue) {
      if ($pendingWithoutAnchor -gt 0 -and -not $forceAnchorRecoveryScroll -and $scrollIndex -lt ($MaxScrolls - 1)) {
        $forceAnchorRecoveryScroll = $true
        Write-ScanLog 'Visible lower bound reached, but top-of-page bubbles still lack anchors; scrolling once more to recover those anchors.'
      } else {
        Write-ScanLog ("Reached visible messages at or before the target lower bound ({0}); stopping scroll loop." -f $visibleOldestTime.ToString('o'))
        break
      }
    } else {
      $forceAnchorRecoveryScroll = $false
    }

    if ($null -ne $visibleOldestTime -and $visibleOldestTime -le $sinceValue -and $forceAnchorRecoveryScroll) {
      Scroll-ChatHistory -ChatPage $chatMessageList
      continue
    }

    if ($noProgressScrolls -ge 2) {
      Write-ScanLog 'Stopping scroll loop because no new visible message items were discovered twice in a row.'
      break
    }

    Scroll-ChatHistory -ChatPage $chatMessageList
    Start-Sleep -Milliseconds 400
  }

  if ($captureRecords.Count -gt 0) {
    $merge = Merge-IndexRecords -IndexPath $resolvedIndexPath -IncomingRecords @($captureRecords.ToArray()) -Reindex:$Reindex
  } else {
    $existingRecords = if ($Reindex) { @() } else { @(Read-JsonLinesFile -Path $resolvedIndexPath) }
    $merge = [PSCustomObject]@{
      added = 0
      skipped = 0
      total = @($existingRecords).Count
      index_path = $resolvedIndexPath
    }
    Write-ScanLog 'No records were captured in the requested window; index merge was skipped.'
  }

  $manifest = [ordered]@{
    status = 'success'
    since = $sinceValue.ToString('o')
    until = $untilValue.ToString('o')
    index_path = $resolvedIndexPath
    records_resolved = $captureRecords.Count
    records_seen = $captureRecords.Count
    records_added = $merge.added
    records_skipped = $merge.skipped
    index_total = $merge.total
    unresolved_total = $script:UnresolvedTotal
    unresolved_reasons = $script:UnresolvedReasons
    artifact_log = $logPath
  }

  Write-RunManifest -RunContext $run -Manifest $manifest

  @(
    "Scan complete."
    "Records seen: $($captureRecords.Count)"
    "Added to index: $($merge.added)"
    "Index total: $($merge.total)"
    "Manifest: $($run.ManifestPath)"
  ) -join [Environment]::NewLine
} catch {
  Write-ScanLog ("ERROR: {0}" -f $_.Exception.Message)
  Write-RunManifest -RunContext $run -Manifest ([ordered]@{
    status = 'failed'
    since = $sinceValue.ToString('o')
    until = $untilValue.ToString('o')
    index_path = $resolvedIndexPath
    records_resolved = 0
    unresolved_total = $script:UnresolvedTotal
    unresolved_reasons = $script:UnresolvedReasons
    artifact_log = $logPath
    error = $_.Exception.Message
  })
  throw
}
