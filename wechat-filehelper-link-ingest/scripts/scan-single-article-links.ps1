[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Since,
  [Parameter(Mandatory = $true)]
  [string]$Until,
  [ValidateRange(1, 200)]
  [int]$MaxScrolls = 30,
  [switch]$Reindex,
  [string]$IndexPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/common.ps1')

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WeChatSingleArticleNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);

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
$run = New-RunContext -CommandName 'scan-single-article-links' -SkillRoot $skillRoot
$resolvedIndexPath = Get-IndexPath -SkillRoot $skillRoot -IndexPath $IndexPath
$sinceValue = ConvertTo-DateTimeOffsetSafe $Since
$untilValue = ConvertTo-DateTimeOffsetSafe $Until
$logPath = Join-Path $run.ArtifactDir 'scan.log'
$candidatePath = Join-Path $run.ArtifactDir 'candidates.json'
$script:FileHelperName = ([char]0x6587)+([char]0x4EF6)+([char]0x4F20)+([char]0x8F93)+([char]0x52A9)+([char]0x624B)
$script:ChatRecordLabel = ([char]0x804A)+([char]0x5929)+([char]0x8BB0)+([char]0x5F55)
$script:LinkPrefix = '[' + (([char]0x94FE)+([char]0x63A5)) + ']'
$script:VideoMarker = ([char]0x89C6)+([char]0x9891)+([char]0x53F7)
$script:BilibiliMarker = ([char]0x54D4)+([char]0x54E9)+([char]0x54D4)+([char]0x54E9)
$script:TodayLabel = ([char]0x4ECA)+([char]0x5929)
$script:YesterdayLabel = ([char]0x6628)+([char]0x5929)
$script:UnresolvedReasons = [ordered]@{}
$script:UnresolvedTotal = 0
$script:FatalReason = $null
$script:AllowLatestAnchorInference = (([DateTimeOffset]::Now - $untilValue).Duration().TotalHours -le 12)
$script:ProcessedCandidateKeys = $null
$script:ResolvedUrlSet = $null
$script:ResolvedRecords = $null
$script:UiShortDelayMs = 120
$script:UiFocusDelayMs = 120
$script:UiSelectionDelayMs = 80
$script:ViewerWaitPollMs = 150
$script:ViewerAppearedTimeoutMs = 2500
$script:ViewerForegroundableTimeoutMs = 1200
$script:ViewerMenuReadyTimeoutMs = 2500
$script:ViewerCloseTimeoutMs = 1500
$script:MainWindowRecoveryTimeoutMs = 2000

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

function Set-FatalReason {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Reason
  )

  if ([string]::IsNullOrWhiteSpace($script:FatalReason)) {
    $script:FatalReason = $Reason
    Write-ScanLog ("FATAL: {0}" -f $Reason)
  }
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

  try {
    return @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
  } catch {
    Write-ScanLog ("Get-Descendants returned no elements because the UIA root became unavailable: {0}" -f $_.Exception.Message)
    return @()
  }
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

  if ([WeChatSingleArticleNative]::IsIconic($handle)) {
    [WeChatSingleArticleNative]::ShowWindowAsync($handle, 9) | Out-Null
    Start-Sleep -Milliseconds $script:UiFocusDelayMs
  }

  [WeChatSingleArticleNative]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds $script:UiFocusDelayMs
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

function Click-Point {
  param(
    [Parameter(Mandatory = $true)]
    [int]$X,
    [Parameter(Mandatory = $true)]
    [int]$Y
  )

  [WeChatSingleArticleNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 60
  [WeChatSingleArticleNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [WeChatSingleArticleNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
}

function Wheel-ScrollAtPoint {
  param(
    [Parameter(Mandatory = $true)]
    [int]$X,
    [Parameter(Mandatory = $true)]
    [int]$Y,
    [Parameter(Mandatory = $true)]
    [int]$Delta,
    [int]$Repeat = 3,
    [int]$DelayMs = 140
  )

  [WeChatSingleArticleNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 50
  for ($i = 0; $i -lt $Repeat; $i++) {
    [WeChatSingleArticleNative]::mouse_event(0x0800, 0, 0, [int]$Delta, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds $DelayMs
  }
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

  return $null
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

function Get-RecordDetailWindows {
  return @(
    Get-TopLevelWindows |
      Where-Object { [string]$_.Current.ClassName -eq 'mmui::RecordDetailWindow' }
  )
}

function Get-InteractiveMainWindowCandidates {
  $candidates = New-Object System.Collections.Generic.List[object]
  foreach ($window in Get-TopLevelWindows) {
    if ([string]$window.Current.ClassName -ne 'mmui::MainWindow') {
      continue
    }

    $chatPage = $window.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_page'))
    )
    if ($null -eq $chatPage) {
      continue
    }

    $chatList = Get-ChatMessageList -Window $window
    if ($null -eq $chatList) {
      continue
    }

    $candidates.Add($window) | Out-Null
  }

  return @($candidates.ToArray())
}

function Get-ProductionGateState {
  $mainWindows = @(Get-InteractiveMainWindowCandidates)
  $viewerWindows = @(Get-WeChatViewerWindows)
  $detailWindows = @(Get-RecordDetailWindows)

  $state = [ordered]@{
    main_window_count = $mainWindows.Count
    viewer_window_count = $viewerWindows.Count
    record_detail_count = $detailWindows.Count
    current_chat_name = $null
    message_list_present = $false
    can_enter_single_article_mode = $false
    reasons = @()
    main_window = $null
  }

  if ($mainWindows.Count -ne 1) {
    $state.reasons += "Expected exactly one interactive WeChat main window, found $($mainWindows.Count)."
  } else {
    $state.main_window = $mainWindows[0]
    $state.current_chat_name = Get-CurrentChatName -Window $mainWindows[0]
    $state.message_list_present = ($null -ne (Get-ChatMessageList -Window $mainWindows[0]))
    if ($state.current_chat_name -ne $script:FileHelperName) {
      $state.reasons += 'Current chat is not 文件传输助手.'
    }
    if (-not $state.message_list_present) {
      $state.reasons += 'chat_message_list is not visible in the current WeChat main window.'
    }
  }

  if ($viewerWindows.Count -gt 0) {
    $state.reasons += 'A WeChat article viewer window is already open.'
  }

  if ($detailWindows.Count -gt 0) {
    $state.reasons += 'A chat-record detail window is already open.'
  }

  $state.can_enter_single_article_mode = ($state.reasons.Count -eq 0)
  return [PSCustomObject]$state
}

function Wait-ForStableProductionGate {
  param(
    [int]$TimeoutMs = $script:MainWindowRecoveryTimeoutMs,
    [int]$PollMs = $script:ViewerWaitPollMs
  )

  $lastGate = $null
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    $lastGate = Get-ProductionGateState
    if ($lastGate.can_enter_single_article_mode) {
      return $lastGate
    }

    Start-Sleep -Milliseconds $PollMs
  }

  if ($null -eq $lastGate) {
    $lastGate = Get-ProductionGateState
  }

  return $lastGate
}

function Assert-ProductionGate {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Stage
  )

  $gate = Get-ProductionGateState
  if ($gate.viewer_window_count -gt 0) {
    Write-ScanLog ("Production gate detected {0} pre-existing WeChat viewer window(s) at stage '{1}'. Attempting safe cleanup." -f $gate.viewer_window_count, $Stage)
    foreach ($viewerWindow in @(Get-WeChatViewerWindows)) {
      if (-not (Close-ViewerWindowGracefully -ViewerWindow $viewerWindow)) {
        Write-ScanLog ("Safe cleanup could not close viewer handle {0}." -f [string]$viewerWindow.Current.NativeWindowHandle)
      }
    }

    $gate = Wait-ForStableProductionGate -TimeoutMs $script:MainWindowRecoveryTimeoutMs -PollMs $script:ViewerWaitPollMs
  }

  if (-not $gate.can_enter_single_article_mode) {
    $reason = '{0}: {1}' -f $Stage, ($gate.reasons -join ' ')
    Set-FatalReason -Reason $reason
    throw $reason
  }

  return $gate.main_window
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
    Left = [int][Math]::Round($rect.Left, 0)
    Top = [int][Math]::Round($rect.Top, 0)
    Width = [int][Math]::Round($rect.Width, 0)
    Height = [int][Math]::Round($rect.Height, 0)
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
    $class = [string]$element.Current.ClassName
    if ($class -notin @('mmui::ChatBubbleItemView', 'mmui::ChatItemView')) {
      continue
    }

    $rect = Get-ElementRectangle -Element $element
    if ($null -eq $rect) {
      continue
    }

    $items.Add([PSCustomObject]@{
      Element = $element
      Name = ([string]$element.Current.Name).Trim()
      AutomationId = [string]$element.Current.AutomationId
      ClassName = $class
      ControlType = [string]$element.Current.ControlType.ProgrammaticName
      Left = $rect.Left
      Top = $rect.Top
      Width = $rect.Width
      Height = $rect.Height
    }) | Out-Null
  }

  return @($items.ToArray() | Sort-Object Top, Left)
}

function Get-MessageItemKind {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return 'unknown'
  }

  if ($Name -like "*$($script:VideoMarker)*") {
    return 'video'
  }

  if ($Name -match 'https?://') {
    return 'text_url'
  }

  if ($Name -match ('^' + [regex]::Escape($script:ChatRecordLabel)) -and $Name -match [regex]::Escape($script:LinkPrefix)) {
    return 'chat_record_bundle'
  }

  if ($Name -match [regex]::Escape($script:LinkPrefix)) {
    return 'share_card'
  }

  return 'unknown'
}

function Test-IsBilibiliLikeMessage {
  param(
    [AllowEmptyString()]
    [string]$Text
  )

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $false
  }

  return (
    $Text -like "*$($script:BilibiliMarker)*" -or
    $Text -match '(?i)bilibili' -or
    $Text -match '(?i)b23\.tv'
  )
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

  $limit = [Math]::Min(24, $value.Length)
  return $value.Substring(0, $limit)
}

function Get-TextFingerprint {
  param(
    [AllowEmptyString()]
    [string]$Text
  )

  $value = if ($null -eq $Text) { '' } else { [string]$Text }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($value.Trim()))
  } finally {
    $sha.Dispose()
  }

  return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
}

function New-LinkRecord {
  param(
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$MessageTime,
    [Parameter(Mandatory = $true)]
    [string]$MessageType,
    [AllowEmptyString()]
    [string]$Title,
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [AllowEmptyString()]
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

function Select-UniqueUrls {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Urls
  )

  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  $ordered = New-Object System.Collections.Generic.List[string]
  foreach ($url in @($Urls)) {
    $canonical = ConvertTo-CanonicalUrl -Url $url
    if ([string]::IsNullOrWhiteSpace($canonical)) {
      continue
    }

    if ($set.Add($canonical)) {
      $ordered.Add($canonical) | Out-Null
    }
  }

  return @($ordered.ToArray())
}

function Scroll-MessageListPageUp {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$MessageList
  )

  Focus-AutomationWindow -Window $Window
  $rect = Get-ElementRectangle -Element $MessageList
  if ($null -ne $rect) {
    Wheel-ScrollAtPoint -X ($rect.Left + [Math]::Max(80, [int]($rect.Width / 2))) -Y ($rect.Top + [Math]::Max(80, [int]($rect.Height / 2))) -Delta 120 -Repeat 5 -DelayMs 110
    return
  }
  Send-Keys -Keys '{PGUP}' -DelayMs 650
}

function Scroll-MessageListPageDown {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Window,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$MessageList
  )

  Focus-AutomationWindow -Window $Window
  $rect = Get-ElementRectangle -Element $MessageList
  if ($null -ne $rect) {
    Wheel-ScrollAtPoint -X ($rect.Left + [Math]::Max(80, [int]($rect.Width / 2))) -Y ($rect.Top + [Math]::Max(80, [int]($rect.Height / 2))) -Delta (-120) -Repeat 5 -DelayMs 110
    return
  }
  Send-Keys -Keys '{PGDN}' -DelayMs 650
}

function Move-DiscoveryStartToLatest {
  $seenPageKeys = New-Object 'System.Collections.Generic.HashSet[string]'
  $stablePages = 0
  $seekScrollLimit = [Math]::Max($MaxScrolls, 40)
  $seenNonEmptyPage = $false

  for ($seekIndex = 0; $seekIndex -lt $seekScrollLimit; $seekIndex++) {
    $mainWindow = Assert-ProductionGate -Stage ("seek-latest-{0}" -f $seekIndex)
    $messageList = Get-ChatMessageList -Window $mainWindow
    if ($null -eq $messageList) {
      throw 'chat_message_list disappeared while seeking the latest visible page.'
    }

    $visibleItems = @(Get-ChatMessageListItems -MessageList $messageList)
    if ($visibleItems.Count -eq 0 -and $seenNonEmptyPage) {
      Write-ScanLog ("Seek-latest overshot into an empty page at step {0}; paging up once to restore the last non-empty page." -f $seekIndex)
      Scroll-MessageListPageUp -Window $mainWindow -MessageList $messageList
      Write-ScanLog 'Seek-latest restored the last non-empty page after empty-page overshoot.'
      return
    }

    if ($visibleItems.Count -gt 0) {
      $seenNonEmptyPage = $true
    }

    $pageSignature = ($visibleItems | ForEach-Object { '{0}|{1}|{2}' -f $_.ClassName, $_.Top, (Get-TextFingerprint -Text $_.Name) }) -join ';'
    if (-not $seenPageKeys.Add($pageSignature)) {
      $stablePages++
      Write-ScanLog ("Seek-latest reached a stable page at step {0}." -f $seekIndex)
    } else {
      $stablePages = 0
    }

    if ($stablePages -ge 2) {
      Write-ScanLog 'Seek-latest finished at the newest visible page.'
      return
    }

    if ($seekIndex -lt ($seekScrollLimit - 1)) {
      Scroll-MessageListPageDown -Window $mainWindow -MessageList $messageList
    }
  }

  Write-ScanLog ("Seek-latest stopped after hitting the safety cap ({0} page-down steps)." -f $seekScrollLimit)
}

function Select-BubbleForOpen {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$BubbleElement,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [Parameter(Mandatory = $true)]
    [ValidateSet('clickable_point', 'invoke', 'legacy', 'enter_fallback')]
    [string]$Method
  )

  $openTriggerStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $selectionPattern = $null
  if (-not $BubbleElement.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
    return [PSCustomObject]@{
      Status = 'failed'
      Method = $null
      OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
      Reason = 'SelectionItemPattern is not available on the target share card bubble.'
    }
  }

  try {
    $selectionPattern.Select()
    Start-Sleep -Milliseconds $script:UiSelectionDelayMs
  } catch {
    return [PSCustomObject]@{
      Status = 'failed'
      Method = $null
      OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
      Reason = ('SelectionItemPattern.Select() failed: {0}' -f $_.Exception.Message)
    }
  }

  try {
    $BubbleElement.SetFocus()
    Start-Sleep -Milliseconds $script:UiSelectionDelayMs
  } catch {
    Write-ScanLog 'Bubble SetFocus() failed after selection; continuing with alternative bubble activation.'
  }

  Focus-AutomationWindow -Window $WeChatWindow

  switch ($Method) {
    'clickable_point' {
      try {
        $clickablePoint = $BubbleElement.GetClickablePoint()
        Click-Point -X ([int][Math]::Round($clickablePoint.X, 0)) -Y ([int][Math]::Round($clickablePoint.Y, 0))
        $openTriggerStopwatch.Stop()
        return [PSCustomObject]@{
          Status = 'ok'
          Method = 'clickable_point'
          OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
          Reason = $null
        }
      } catch {
        return [PSCustomObject]@{
          Status = 'failed'
          Method = 'clickable_point'
          OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
          Reason = ('GetClickablePoint() failed: {0}' -f $_.Exception.Message)
        }
      }
    }
    'invoke' {
      $invokePattern = $null
      try {
        if ($BubbleElement.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
          $invokePattern.Invoke()
          Start-Sleep -Milliseconds $script:UiShortDelayMs
          $openTriggerStopwatch.Stop()
          return [PSCustomObject]@{
            Status = 'ok'
            Method = 'invoke'
            OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
            Reason = $null
          }
        }
      } catch {
      }

      return [PSCustomObject]@{
        Status = 'failed'
        Method = 'invoke'
        OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
        Reason = 'InvokePattern is not available or failed for the target share card bubble.'
      }
    }
    'legacy' {
      if (Test-LegacyPatternSupported) {
        $legacyPattern = $null
        try {
          if ($BubbleElement.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
            $legacyPattern.DoDefaultAction()
            Start-Sleep -Milliseconds $script:UiShortDelayMs
            $openTriggerStopwatch.Stop()
            return [PSCustomObject]@{
              Status = 'ok'
              Method = 'legacy'
              OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
              Reason = $null
            }
          }
        } catch {
        }
      }

      return [PSCustomObject]@{
        Status = 'failed'
        Method = 'legacy'
        OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
        Reason = 'LegacyIAccessiblePattern is not available or failed for the target share card bubble.'
      }
    }
    'enter_fallback' {
      Send-Keys -Keys '{ENTER}' -DelayMs 220
      $openTriggerStopwatch.Stop()
      Write-ScanLog 'Share card open used enter_fallback after UIA-native activation methods were unavailable.'
      return [PSCustomObject]@{
        Status = 'ok'
        Method = 'enter_fallback'
        OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
        Reason = $null
      }
    }
  }

  return [PSCustomObject]@{
    Status = 'failed'
    Method = $Method
    OpenTriggerMs = $openTriggerStopwatch.ElapsedMilliseconds
    Reason = ('Unsupported bubble open method: {0}' -f $Method)
  }
}

function Test-LegacyPatternSupported {
  return ($null -ne ('System.Windows.Automation.LegacyIAccessiblePattern' -as [type]))
}

function Get-BubbleOpenMethodPlan {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$BubbleElement
  )

  $methods = New-Object System.Collections.Generic.List[string]

  try {
    $null = $BubbleElement.GetClickablePoint()
    $methods.Add('clickable_point') | Out-Null
  } catch {
  }

  $invokePattern = $null
  if ($BubbleElement.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
    $methods.Add('invoke') | Out-Null
  }

  if (Test-LegacyPatternSupported) {
    $legacyPattern = $null
    if ($BubbleElement.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
      $methods.Add('legacy') | Out-Null
    }
  }

  $methods.Add('enter_fallback') | Out-Null
  return @($methods.ToArray() | Select-Object -Unique)
}

function Wait-ForNewViewerWindow {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ViewerHandlesBefore,
    [int]$ViewerAppearedTimeoutMs = $script:ViewerAppearedTimeoutMs,
    [int]$ViewerForegroundableTimeoutMs = $script:ViewerForegroundableTimeoutMs,
    [int]$ViewerMenuReadyTimeoutMs = $script:ViewerMenuReadyTimeoutMs,
    [int]$PollMs = $script:ViewerWaitPollMs
  )

  $viewerWindow = $null
  $viewerAppearedStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $deadline = [DateTime]::UtcNow.AddMilliseconds($ViewerAppearedTimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    $gate = Get-ProductionGateState
    if ($gate.main_window_count -ne 1) {
      return [PSCustomObject]@{ Status = 'fatal'; Viewer = $null; Reason = 'WeChat main window count changed while waiting for the article viewer.' }
    }

    $currentViewerWindows = @(Get-WeChatViewerWindows)
    foreach ($viewerWindow in $currentViewerWindows) {
      $handle = [string]$viewerWindow.Current.NativeWindowHandle
      if ($handle -notin $ViewerHandlesBefore) {
        $viewerAppearedStopwatch.Stop()
        $candidateViewer = $viewerWindow
        $viewerWindow = $candidateViewer
        break
      }
    }

    if ($null -ne $viewerWindow) {
      break
    }

    Start-Sleep -Milliseconds $PollMs
  }

  if ($null -eq $viewerWindow) {
    return [PSCustomObject]@{
      Status = 'no_viewer'
      Viewer = $null
      Reason = 'A new independent WeChat article viewer window did not appear after opening the share card.'
      ViewerAppearedMs = $viewerAppearedStopwatch.ElapsedMilliseconds
      ViewerForegroundableMs = 0
      ViewerMenuReadyMs = 0
      MenuReady = $false
    }
  }

  $viewerForegroundStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $deadline = [DateTime]::UtcNow.AddMilliseconds($ViewerForegroundableTimeoutMs)
  $viewerForegroundable = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    $gate = Get-ProductionGateState
    if ($gate.main_window_count -ne 1) {
      return [PSCustomObject]@{ Status = 'fatal'; Viewer = $null; Reason = 'WeChat main window count changed while preparing the article viewer.' }
    }

    try {
      Focus-AutomationWindow -Window $viewerWindow
      $viewerWindow.SetFocus()
      $viewerForegroundable = $true
      break
    } catch {
    }

    Start-Sleep -Milliseconds $PollMs
  }
  $viewerForegroundStopwatch.Stop()

  if (-not $viewerForegroundable) {
    return [PSCustomObject]@{
      Status = 'fatal'
      Viewer = $null
      Reason = 'The new WeChat article viewer could not be foregrounded safely.'
      ViewerAppearedMs = $viewerAppearedStopwatch.ElapsedMilliseconds
      ViewerForegroundableMs = $viewerForegroundStopwatch.ElapsedMilliseconds
      ViewerMenuReadyMs = 0
      MenuReady = $false
    }
  }

  $viewerMenuReadyStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $deadline = [DateTime]::UtcNow.AddMilliseconds($ViewerMenuReadyTimeoutMs)
  $menuReady = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($null -ne (Find-ViewerMenuButton -ViewerWindow $viewerWindow)) {
      $menuReady = $true
      break
    }

    Start-Sleep -Milliseconds $PollMs
  }
  $viewerMenuReadyStopwatch.Stop()

  return [PSCustomObject]@{
    Status = 'ok'
    Viewer = $viewerWindow
    Reason = $null
    ViewerAppearedMs = $viewerAppearedStopwatch.ElapsedMilliseconds
    ViewerForegroundableMs = $viewerForegroundStopwatch.ElapsedMilliseconds
    ViewerMenuReadyMs = $viewerMenuReadyStopwatch.ElapsedMilliseconds
    MenuReady = $menuReady
  }
}

function Find-ViewerMenuButton {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ViewerWindow
  )

  $candidates = @(
    Get-Descendants -Root $ViewerWindow |
      Where-Object {
        $type = [string]$_.Current.ControlType.ProgrammaticName
        if ($type -notin @('ControlType.Button', 'ControlType.SplitButton', 'ControlType.MenuItem')) {
          return $false
        }

        $rect = Get-ElementRectangle -Element $_
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

  return @($candidates | Sort-Object { (Get-ElementRectangle -Element $_).Top }, { (Get-ElementRectangle -Element $_).Left })[0]
}

function Find-ViewerCloseButton {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ViewerWindow
  )

  $candidates = @(
    Get-Descendants -Root $ViewerWindow |
      Where-Object {
        $type = [string]$_.Current.ControlType.ProgrammaticName
        if ($type -notin @('ControlType.Button', 'ControlType.MenuItem')) {
          return $false
        }

        $name = [string]$_.Current.Name
        return (
          $name -like '*关闭*' -or
          $name -like '*Close*' -or
          $name -eq '×'
        )
      }
  )

  if ($candidates.Count -eq 0) {
    return $null
  }

  return $candidates | Select-Object -First 1
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
      Start-Sleep -Milliseconds $script:UiShortDelayMs
      return $true
    }
  } catch {
  }

  $legacyPattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
      $legacyPattern.DoDefaultAction()
      Start-Sleep -Milliseconds $script:UiShortDelayMs
      return $true
    }
  } catch {
  }

  return $false
}

function Close-ViewerWindowGracefully {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ViewerWindow
  )

  Focus-AutomationWindow -Window $ViewerWindow

  $windowPattern = $null
  try {
    if ($ViewerWindow.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$windowPattern)) {
      $windowPattern.Close()
      return $true
    }
  } catch {
  }

  $closeButton = Find-ViewerCloseButton -ViewerWindow $ViewerWindow
  if ($null -ne $closeButton) {
    if (Try-InvokeUiElement -Element $closeButton) {
      return $true
    }
  }

  return $false
}

function Wait-ForViewerWindowClosed {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ViewerHandle,
    [int]$TimeoutMs = $script:ViewerCloseTimeoutMs,
    [int]$PollMs = $script:ViewerWaitPollMs
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    $stillOpen = @(
      Get-WeChatViewerWindows |
        Where-Object { [string]$_.Current.NativeWindowHandle -eq $ViewerHandle }
    )
    if ($stillOpen.Count -eq 0) {
      return $true
    }

    Start-Sleep -Milliseconds $PollMs
  }

  return $false
}

function Read-ExtractorResult {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$ExtractorResult
  )

  if ($null -eq $ExtractorResult) {
    return [PSCustomObject]@{ Status = 'no_url'; Url = $null; Error = 'Extractor returned no result.'; UsedBrowserFallback = $false }
  }

  if ($ExtractorResult -is [array]) {
    $ExtractorResult = $ExtractorResult | Select-Object -Last 1
  }

  return [PSCustomObject]@{
    Status = [string]$ExtractorResult.status
    Url = [string]$ExtractorResult.url
    Error = [string]$ExtractorResult.error
    UsedBrowserFallback = [bool]$ExtractorResult.used_browser_fallback
  }
}

function Invoke-ArticleExtractor {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$ViewerWindow,
    [AllowNull()]
    [string]$ExpectedTitleFragment
  )

  $config = [ordered]@{
    viewer_handle = [string]$ViewerWindow.Current.NativeWindowHandle
    require_mp_weixin = $true
    allow_browser_fallback = $true
    expected_title_fragment = $ExpectedTitleFragment
    log_path = $logPath
  }

  $inputPath = Join-Path $run.ArtifactDir ('extract-input-{0}.json' -f ([guid]::NewGuid().ToString('N')))
  try {
    $config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $inputPath -Encoding UTF8
    $extractScript = Join-Path $PSScriptRoot 'extract-current-article-link.ps1'
    $result = & $extractScript -InputJsonPath $inputPath
    return Read-ExtractorResult -ExtractorResult $result
  } finally {
    Remove-Item -LiteralPath $inputPath -ErrorAction SilentlyContinue
  }
}

function Convert-TextUrlCandidateToRecords {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Candidate
  )

  $records = New-Object System.Collections.Generic.List[object]
  $urls = @(Select-UniqueUrls -Urls (Get-UrlMatchesFromText -Text $Candidate.source_text))
  foreach ($url in $urls) {
    $record = New-LinkRecord -MessageTime $Candidate.message_time -MessageType 'text_url' -Title $Candidate.title -Url $url -SourceText $Candidate.source_text -SessionId $run.SessionId
    if ($null -ne $record) {
      $records.Add($record) | Out-Null
    }
  }

  return @($records.ToArray())
}

function Build-CandidateFromBubble {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Item,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$MessageTime,
    [Parameter(Mandatory = $true)]
    [int]$ScrollIndex,
    [bool]$TimeInferred = $false
  )

  $kind = Get-MessageItemKind -Name $Item.Name
  if ($kind -notin @('text_url', 'share_card', 'video', 'chat_record_bundle', 'unknown')) {
    return $null
  }

  if ($kind -eq 'video') {
    Add-UnresolvedReason -Reason 'video_message_skipped' -Detail ("Skipped video-like message: {0}" -f $Item.Name)
    return $null
  }

  if ($kind -eq 'chat_record_bundle') {
    Add-UnresolvedReason -Reason 'bundle_message_skipped' -Detail ("Skipped chat-record bundle in single-article mode: {0}" -f (Get-TitleFragment -Text $Item.Name))
    return $null
  }

  if ($kind -eq 'unknown') {
    Add-UnresolvedReason -Reason 'unknown_message_skipped' -Detail ("Skipped unknown non-video message: {0}" -f $Item.Name)
    return $null
  }

  if (Test-IsBilibiliLikeMessage -Text $Item.Name) {
    Add-UnresolvedReason -Reason 'bilibili_message_skipped' -Detail ("Skipped bilibili-like message: {0}" -f $Item.Name)
    return $null
  }

  if ($MessageTime -lt $sinceValue -or $MessageTime -gt $untilValue) {
    return $null
  }

  $title = if ($kind -eq 'share_card') { Get-TitleFragment -Text $Item.Name } else { Get-TitleFragment -Text $Item.Name }
  if ([string]::IsNullOrWhiteSpace($title)) {
    $title = $Item.Name
  }

  return [PSCustomObject]@{
    scroll_index = $ScrollIndex
    message_time = $MessageTime
    kind = $kind
    message_key = $null
    title = $title
    source_text = $Item.Name
    bubble_name_fingerprint = Get-TextFingerprint -Text $Item.Name
    top = $Item.Top
    time_inferred = [bool]$TimeInferred
  }
}

function Get-CandidateMessageKey {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Candidate
  )

  $minuteAnchor = $Candidate.message_time.ToString('yyyy-MM-ddTHH:mm')
  return '{0}|{1}|{2}' -f $Candidate.kind, $minuteAnchor, $Candidate.bubble_name_fingerprint
}

function Get-CandidateFingerprintKey {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Candidate
  )

  return '{0}|{1}' -f $Candidate.kind, $Candidate.bubble_name_fingerprint
}

function Register-Candidate {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Candidate,
    [Parameter(Mandatory = $true)]
    [hashtable]$CandidateMap,
    [Parameter(Mandatory = $true)]
    [hashtable]$FingerprintIndex
  )

  $candidateKey = Get-CandidateMessageKey -Candidate $Candidate
  $fingerprintKey = Get-CandidateFingerprintKey -Candidate $Candidate

  if ($CandidateMap.Contains($candidateKey)) {
    return $CandidateMap[$candidateKey]
  }

  if ($FingerprintIndex.Contains($fingerprintKey)) {
    $existingKey = [string]$FingerprintIndex[$fingerprintKey]
    if ($CandidateMap.Contains($existingKey)) {
      $existing = $CandidateMap[$existingKey]
      if ($existing.time_inferred -and -not $Candidate.time_inferred) {
        $Candidate.message_key = $candidateKey
        $CandidateMap.Remove($existingKey)
        $CandidateMap[$candidateKey] = $Candidate
        $FingerprintIndex[$fingerprintKey] = $candidateKey
        if ($script:ProcessedCandidateKeys.Contains($existingKey)) {
          $script:ProcessedCandidateKeys.Add($candidateKey) | Out-Null
        }
        return $Candidate
      }

      return $existing
    }
  }

  $Candidate.message_key = $candidateKey
  $CandidateMap[$candidateKey] = $Candidate
  $FingerprintIndex[$fingerprintKey] = $candidateKey
  return $Candidate
}

function Add-RecordIfNewUrl {
  param(
    [Parameter(Mandatory = $true)]
    [AllowNull()]
    [psobject]$Record
  )

  if ($null -eq $Record) {
    return
  }

  if ($script:ResolvedUrlSet.Add([string]$Record.url)) {
    $script:ResolvedRecords.Add($Record) | Out-Null
    return
  }

  Write-ScanLog ("Skipping duplicate canonical URL in current run: {0}" -f [string]$Record.url)
}

function Process-VisiblePageCandidates {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ScrollIndex,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$MessageList,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [psobject[]]$VisibleItems,
    [Parameter(Mandatory = $true)]
    [ref]$CurrentDayAnchor,
    [Parameter(Mandatory = $true)]
    [hashtable]$CandidateMap,
    [Parameter(Mandatory = $true)]
    [hashtable]$FingerprintIndex
  )

  $pendingWithoutAnchor = 0
  $visibleEarliest = $null

  foreach ($item in $VisibleItems) {
    if ($item.ClassName -eq 'mmui::ChatItemView') {
      $resolvedAnchor = Resolve-WeChatTimestamp -RawText $item.Name -Fallback ([DateTimeOffset]::Now) -CurrentDayAnchor $CurrentDayAnchor.Value
      $CurrentDayAnchor.Value = $resolvedAnchor
      if ($null -eq $visibleEarliest -or $resolvedAnchor -lt $visibleEarliest) {
        $visibleEarliest = $resolvedAnchor
      }
      continue
    }

    if ($null -eq $CurrentDayAnchor.Value) {
      if ($script:AllowLatestAnchorInference) {
        $candidate = Build-CandidateFromBubble -Item $item -MessageTime $untilValue -ScrollIndex $ScrollIndex -TimeInferred $true
      } else {
        $pendingWithoutAnchor++
        continue
      }
    } else {
      $candidate = Build-CandidateFromBubble -Item $item -MessageTime $CurrentDayAnchor.Value -ScrollIndex $ScrollIndex
    }

    if ($null -eq $candidate) {
      continue
    }

    $registeredCandidate = Register-Candidate -Candidate $candidate -CandidateMap $CandidateMap -FingerprintIndex $FingerprintIndex
    $candidateKey = Get-CandidateMessageKey -Candidate $registeredCandidate
    $registeredCandidate.message_key = $candidateKey
    if ($script:ProcessedCandidateKeys.Contains($candidateKey)) {
      continue
    }

    if ($registeredCandidate.kind -eq 'text_url') {
      foreach ($record in @(Convert-TextUrlCandidateToRecords -Candidate $registeredCandidate)) {
        Add-RecordIfNewUrl -Record $record
      }
      $script:ProcessedCandidateKeys.Add($candidateKey) | Out-Null
      continue
    }

    $currentWindow = Assert-ProductionGate -Stage ("process-share-card-scroll-{0}" -f $ScrollIndex)
    $currentMessageList = Get-ChatMessageList -Window $currentWindow
    if ($null -eq $currentMessageList) {
      throw 'chat_message_list is no longer visible before processing a share card candidate on the current page.'
    }

    $record = Process-ShareCardCandidate -Candidate $registeredCandidate -WeChatWindow $currentWindow -MessageList $currentMessageList
    Add-RecordIfNewUrl -Record $record
    $script:ProcessedCandidateKeys.Add($candidateKey) | Out-Null
  }

  return [PSCustomObject]@{
    PendingWithoutAnchor = $pendingWithoutAnchor
    VisibleEarliest = $visibleEarliest
  }
}

function Find-VisibleBubbleForCandidate {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Candidate,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$MessageList
  )

  $items = @(Get-ChatMessageListItems -MessageList $MessageList)
  $matches = @(
    $items |
      Where-Object {
        $_.ClassName -eq 'mmui::ChatBubbleItemView' -and
        (Get-TextFingerprint -Text $_.Name) -eq $Candidate.bubble_name_fingerprint
      } |
      Sort-Object Top
  )

  if ($matches.Count -eq 0) {
    return $null
  }

  return $matches[0]
}

function Process-ShareCardCandidate {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Candidate,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$WeChatWindow,
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$MessageList
  )

  $visibleBubble = Find-VisibleBubbleForCandidate -Candidate $Candidate -MessageList $MessageList
  if ($null -eq $visibleBubble -or $null -eq $visibleBubble.Element) {
    Add-UnresolvedReason -Reason 'share_card_not_visible_on_expected_page' -Detail ("Could not re-locate share card on scroll {0}: {1}" -f $Candidate.scroll_index, $Candidate.title)
    return $null
  }

  $viewerHandlesBefore = @(Get-WeChatViewerWindows | ForEach-Object { [string]$_.Current.NativeWindowHandle })
  $openMethods = @(Get-BubbleOpenMethodPlan -BubbleElement $visibleBubble.Element)
  $openResult = $null
  $viewerWait = $null
  foreach ($openMethod in $openMethods) {
    $attemptViewerHandlesBefore = @(Get-WeChatViewerWindows | ForEach-Object { [string]$_.Current.NativeWindowHandle })
    $attemptResult = Select-BubbleForOpen -BubbleElement $visibleBubble.Element -WeChatWindow $WeChatWindow -Method $openMethod
    if ($attemptResult.Status -ne 'ok') {
      Write-ScanLog ("open_method={0}" -f [string]$attemptResult.Method)
      Write-ScanLog ("select_to_open_trigger_ms={0}" -f [int]$attemptResult.OpenTriggerMs)
      Write-ScanLog ("open_method_failed={0}: {1}" -f [string]$attemptResult.Method, [string]$attemptResult.Reason)
      continue
    }

    Write-ScanLog ("open_method={0}" -f [string]$attemptResult.Method)
    Write-ScanLog ("select_to_open_trigger_ms={0}" -f [int]$attemptResult.OpenTriggerMs)

    $attemptViewerWait = Wait-ForNewViewerWindow -ViewerHandlesBefore $attemptViewerHandlesBefore
    if ($attemptViewerWait.Status -eq 'ok' -and $null -ne $attemptViewerWait.Viewer) {
      $openResult = $attemptResult
      $viewerWait = $attemptViewerWait
      break
    }

    if ($attemptViewerWait.Status -eq 'fatal') {
      Set-FatalReason -Reason $attemptViewerWait.Reason
      throw $script:FatalReason
    }

    Write-ScanLog ("open_method_no_viewer={0}" -f [string]$attemptResult.Method)
  }

  if ($null -eq $viewerWait -or $viewerWait.Status -ne 'ok' -or $null -eq $viewerWait.Viewer) {
    Add-UnresolvedReason -Reason 'share_card_viewer_not_opened' -Detail ("No independent viewer appeared for share card: {0} (methods={1})" -f $Candidate.title, ($openMethods -join ',')) 
    return $null
  }
  Write-ScanLog ("open_trigger_to_viewer_ms={0}" -f $viewerWait.ViewerAppearedMs)
  Write-ScanLog ("viewer_open_total_ms={0}" -f ([int]$openResult.OpenTriggerMs + [int]$viewerWait.ViewerAppearedMs))
  Write-ScanLog ("viewer_to_menu_ready_ms={0}" -f ($viewerWait.ViewerForegroundableMs + $viewerWait.ViewerMenuReadyMs))

  $mainGate = Get-ProductionGateState
  if ($mainGate.main_window_count -ne 1 -or $mainGate.current_chat_name -ne $script:FileHelperName -or -not $mainGate.message_list_present) {
    Set-FatalReason -Reason 'WeChat main window became unstable after opening the single article viewer.'
    throw $script:FatalReason
  }

  $extractResult = Invoke-ArticleExtractor -ViewerWindow $viewerWait.Viewer -ExpectedTitleFragment $Candidate.title
  $record = $null
  if ($extractResult.Status -eq 'ok' -and -not [string]::IsNullOrWhiteSpace($extractResult.Url)) {
    $record = New-LinkRecord -MessageTime $Candidate.message_time -MessageType 'share_card' -Title $Candidate.title -Url $extractResult.Url -SourceText $Candidate.source_text -SessionId $run.SessionId
    if ($extractResult.UsedBrowserFallback) {
      Write-ScanLog ("Captured share card URL via browser fallback: {0}" -f $extractResult.Url)
    } else {
      Write-ScanLog ("Captured share card URL via viewer menu: {0}" -f $extractResult.Url)
    }
  } else {
    Add-UnresolvedReason -Reason 'share_card_extractor_failed' -Detail ("Failed to extract URL for share card: {0}. {1}" -f $Candidate.title, $extractResult.Error)
  }

  $closeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  if (-not (Close-ViewerWindowGracefully -ViewerWindow $viewerWait.Viewer)) {
    Set-FatalReason -Reason 'Failed to close the newly opened WeChat article viewer using a safe UIA-only method.'
    throw $script:FatalReason
  }

  if (-not (Wait-ForViewerWindowClosed -ViewerHandle ([string]$viewerWait.Viewer.Current.NativeWindowHandle))) {
    Set-FatalReason -Reason 'The newly opened WeChat article viewer remained open after a safe close attempt.'
    throw $script:FatalReason
  }
  $closeStopwatch.Stop()
  Write-ScanLog ("close_viewer_ms={0}" -f $closeStopwatch.ElapsedMilliseconds)

  $postGateStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $postGate = Wait-ForStableProductionGate -TimeoutMs $script:MainWindowRecoveryTimeoutMs -PollMs $script:ViewerWaitPollMs
  $postGateStopwatch.Stop()
  Write-ScanLog ("main_window_recovery_ms={0}" -f $postGateStopwatch.ElapsedMilliseconds)
  if (-not $postGate.can_enter_single_article_mode) {
    Set-FatalReason -Reason ('WeChat main window did not recover to a stable File Transfer Assistant state after closing the viewer. ' + ($postGate.reasons -join ' '))
    throw $script:FatalReason
  }

  return $record
}

try {
  Write-ScanLog ("Starting single-article scan with Since={0}, Until={1}, MaxScrolls={2}, Reindex={3}" -f $sinceValue.ToString('o'), $untilValue.ToString('o'), $MaxScrolls, $Reindex.IsPresent)
  Move-DiscoveryStartToLatest
  $candidateMap = [ordered]@{}
  $fingerprintIndex = @{}
  $script:ProcessedCandidateKeys = New-Object 'System.Collections.Generic.HashSet[string]'
  $script:ResolvedUrlSet = New-Object 'System.Collections.Generic.HashSet[string]'
  $seenPageKeys = New-Object 'System.Collections.Generic.HashSet[string]'
  $consecutiveNoNewPages = 0
  $currentDayAnchor = $null
  $script:ResolvedRecords = New-Object System.Collections.Generic.List[object]
  $lastScrollIndex = 0

  for ($scrollIndex = 0; $scrollIndex -lt $MaxScrolls; $scrollIndex++) {
    $lastScrollIndex = $scrollIndex
    if ($script:FatalReason) {
      break
    }

    $mainWindow = Assert-ProductionGate -Stage ("stream-scroll-{0}" -f $scrollIndex)
    $messageList = Get-ChatMessageList -Window $mainWindow
    if ($null -eq $messageList) {
      throw 'chat_message_list disappeared during streaming scan.'
    }

    Write-ScanLog ("Collecting and processing visible message items at stream scroll {0}" -f $scrollIndex)
    $visibleItems = @(Get-ChatMessageListItems -MessageList $messageList)
    $pageSignature = ($visibleItems | ForEach-Object { '{0}|{1}|{2}' -f $_.ClassName, $_.Top, (Get-TextFingerprint -Text $_.Name) }) -join ';'
    $isNewPage = $seenPageKeys.Add($pageSignature)
    if (-not $isNewPage) {
      $consecutiveNoNewPages++
      Write-ScanLog ("No new visible message items were discovered at stream scroll {0}." -f $scrollIndex)
    } else {
      $consecutiveNoNewPages = 0
    }

    $pageResult = Process-VisiblePageCandidates -ScrollIndex $scrollIndex -WeChatWindow $mainWindow -MessageList $messageList -VisibleItems $visibleItems -CurrentDayAnchor ([ref]$currentDayAnchor) -CandidateMap $candidateMap -FingerprintIndex $fingerprintIndex

    if ($null -ne $pageResult.VisibleEarliest -and $pageResult.VisibleEarliest -le $sinceValue) {
      if ($pageResult.PendingWithoutAnchor -gt 0 -and $scrollIndex -lt ($MaxScrolls - 1)) {
        Write-ScanLog 'Visible lower bound reached, but top-of-page bubbles still lack anchors; scrolling once more to recover those anchors.'
      } else {
        Write-ScanLog ("Stopping stream scan because visible earliest anchor {0} is older than Since." -f $pageResult.VisibleEarliest.ToString('o'))
        break
      }
    }

    if ($consecutiveNoNewPages -ge 2) {
      Write-ScanLog 'Stopping stream scan because no new visible message items were discovered twice in a row.'
      break
    }

    if ($scrollIndex -lt ($MaxScrolls - 1)) {
      Scroll-MessageListPageUp -Window $mainWindow -MessageList $messageList
    }
  }

  $candidates = @($candidateMap.Values | Sort-Object { $_.message_time }, top)
  $candidates | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $candidatePath -Encoding UTF8
  Write-ScanLog ("Stream scan finished with {0} unique candidate(s) and {1} processed candidate(s)." -f $candidates.Count, $script:ProcessedCandidateKeys.Count)

  $merge = if ($script:ResolvedRecords.Count -gt 0) {
    Merge-IndexRecords -IndexPath $resolvedIndexPath -IncomingRecords @($script:ResolvedRecords.ToArray()) -Reindex:$Reindex
  } else {
    [PSCustomObject]@{ total = @(Read-JsonLinesFile -Path $resolvedIndexPath).Count; added = 0; skipped = 0 }
  }

  $status = if ([string]::IsNullOrWhiteSpace($script:FatalReason)) { 'success' } else { 'failed' }
  $manifest = [ordered]@{
    status = $status
    error = $script:FatalReason
    since = $sinceValue.ToString('o')
    until = $untilValue.ToString('o')
    index_path = $resolvedIndexPath
    candidates_path = $candidatePath
    candidates_seen = $candidates.Count
    processed_candidates = $script:ProcessedCandidateKeys.Count
    records_resolved = $script:ResolvedRecords.Count
    records_added = $merge.added
    records_skipped = $merge.skipped
    index_total = $merge.total
    unresolved_total = $script:UnresolvedTotal
    unresolved_reasons = $script:UnresolvedReasons
    artifact_log = $logPath
  }
  Write-RunManifest -RunContext $run -Manifest $manifest

  if ($status -eq 'failed') {
    throw $script:FatalReason
  }

  Write-Output 'Scan complete.'
  Write-Output ("Candidates seen: {0}" -f $candidates.Count)
  Write-Output ("Processed candidates: {0}" -f $script:ProcessedCandidateKeys.Count)
  Write-Output ("Records resolved: {0}" -f $script:ResolvedRecords.Count)
  Write-Output ("Added to index: {0}" -f $merge.added)
  Write-Output ("Index total: {0}" -f $merge.total)
  Write-Output ("Manifest: {0}" -f $run.ManifestPath)
} catch {
  if ([string]::IsNullOrWhiteSpace($script:FatalReason)) {
    Set-FatalReason -Reason $_.Exception.Message
  }

  $manifest = [ordered]@{
    status = 'failed'
    error = $script:FatalReason
    since = $sinceValue.ToString('o')
    until = $untilValue.ToString('o')
    index_path = $resolvedIndexPath
    candidates_path = $candidatePath
    unresolved_total = $script:UnresolvedTotal
    unresolved_reasons = $script:UnresolvedReasons
    artifact_log = $logPath
  }
  Write-RunManifest -RunContext $run -Manifest $manifest
  throw
}
