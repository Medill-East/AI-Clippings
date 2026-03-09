[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/common.ps1')

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$skillRoot = Get-SkillRoot
$run = New-RunContext -CommandName 'diagnose-filehelper' -SkillRoot $skillRoot
$logPath = Join-Path $run.ArtifactDir 'diagnose.log'
$visibleItemsPath = Join-Path $run.ArtifactDir 'visible-items.json'
$script:FileHelperName = ([char]0x6587)+([char]0x4EF6)+([char]0x4F20)+([char]0x8F93)+([char]0x52A9)+([char]0x624B)
$script:ChatRecordLabel = ([char]0x804A)+([char]0x5929)+([char]0x8BB0)+([char]0x5F55)
$script:LinkPrefix = '[' + (([char]0x94FE)+([char]0x63A5)) + ']'
$script:VideoMarker = ([char]0x89C6)+([char]0x9891)+([char]0x53F7)
$script:WeChatWindowName = ([char]0x5FAE)+([char]0x4FE1)

function Write-DiagnoseLog {
  param([string]$Message)

  $line = '[{0}] {1}' -f ([DateTimeOffset]::Now.ToString('o')), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
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

function Find-WeChatChatWindow {
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

    $chatList = $window.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_list'))
    )

    $score = 8
    if ($null -ne $chatList) {
      $score += 4
    }

    $chatNameLabel = $window.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'content_view.top_content_view.title_h_view.left_v_view.left_content_v_view.left_ui_.big_title_line_h_view.current_chat_name_label'))
    )
    if ($null -ne $chatNameLabel) {
      $score += 2
    }

    $candidates.Add([PSCustomObject]@{
      Window = $window
      Score = $score
      Name = [string]$window.Current.Name
      Class = [string]$window.Current.ClassName
    }) | Out-Null
  }

  return $candidates | Sort-Object Score -Descending | Select-Object -First 1
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
    Left = [int][Math]::Round($rect.Left, 0)
    Top = [int][Math]::Round($rect.Top, 0)
    Width = [int][Math]::Round($rect.Width, 0)
    Height = [int][Math]::Round($rect.Height, 0)
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

function Get-PatternSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Element
  )

  $invokeSupported = $false
  $selectSupported = $false
  $legacySupported = $false
  $clickablePoint = $null

  $pattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $invokeSupported = $true
    }
  } catch {
  }

  $pattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
      $selectSupported = $true
    }
  } catch {
  }

  $pattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$pattern)) {
      $legacySupported = $true
    }
  } catch {
  }

  try {
    $point = $Element.GetClickablePoint()
    $clickablePoint = [PSCustomObject]@{
      x = [int][Math]::Round($point.X, 0)
      y = [int][Math]::Round($point.Y, 0)
    }
  } catch {
  }

  return [PSCustomObject]@{
    invoke = $invokeSupported
    selection = $selectSupported
    legacy = $legacySupported
    clickable_point = $clickablePoint
    has_clickable_point = ($null -ne $clickablePoint)
  }
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

function Get-RiskProfile {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('text_url', 'share_card', 'chat_record_bundle', 'video', 'unknown')]
    [string]$Kind
  )

  $profile = [ordered]@{
    would_open_share_card = $false
    would_open_bundle = $false
    would_use_ratio_menu_fallback = $false
    would_use_ctrl_w_close = $false
    would_use_alt_f4_close = $false
  }

  switch ($Kind) {
    'share_card' {
      $profile.would_open_share_card = $true
      $profile.would_use_ratio_menu_fallback = $true
      $profile.would_use_ctrl_w_close = $true
    }
    'chat_record_bundle' {
      $profile.would_open_bundle = $true
      $profile.would_use_ratio_menu_fallback = $true
      $profile.would_use_ctrl_w_close = $true
      $profile.would_use_alt_f4_close = $true
    }
  }

  return [PSCustomObject]$profile
}

function Get-SingleArticleGate {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$WindowCounts,
    [AllowNull()]
    [string]$CurrentChatName,
    [bool]$MessageListVisible,
    [Parameter(Mandatory = $true)]
    [hashtable]$ClassificationCounts
  )

  $reasons = New-Object System.Collections.Generic.List[string]
  if ($WindowCounts.wechat_main -ne 1) {
    $reasons.Add("Expected exactly one interactive WeChat main window, found $($WindowCounts.wechat_main).") | Out-Null
  }
  if ($WindowCounts.wechat_viewer -gt 0) {
    $reasons.Add('A WeChat article viewer window is already open.') | Out-Null
  }
  if ($WindowCounts.record_detail -gt 0) {
    $reasons.Add('A chat-record detail window is already open.') | Out-Null
  }
  if ($CurrentChatName -ne $script:FileHelperName) {
    $reasons.Add('Current chat is not 文件传输助手.') | Out-Null
  }
  if (-not $MessageListVisible) {
    $reasons.Add('chat_message_list is not visible.') | Out-Null
  }

  return [PSCustomObject]@{
    can_enter_single_article_mode = ($reasons.Count -eq 0)
    reasons = @($reasons.ToArray())
    visible_single_article_count = [int]$ClassificationCounts.share_card
    visible_text_url_count = [int]$ClassificationCounts.text_url
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

    $name = ([string]$element.Current.Name).Trim()
    $patterns = Get-PatternSnapshot -Element $element
    $itemType = if ($class -eq 'mmui::ChatItemView') { 'time_anchor' } else { 'bubble' }
    $kind = if ($itemType -eq 'bubble') { Get-MessageItemKind -Name $name } else { 'time_anchor' }
    $risk = if ($itemType -eq 'bubble') { Get-RiskProfile -Kind $kind } else { $null }

    $items.Add([PSCustomObject]@{
      item_type = $itemType
      class = $class
      control_type = [string]$element.Current.ControlType.ProgrammaticName
      name = $name
      automation_id = [string]$element.Current.AutomationId
      top = $rect.Top
      left = $rect.Left
      width = $rect.Width
      height = $rect.Height
      timestamp_like = (Test-TimestampLikeText -Text $name)
      capabilities = $patterns
      classification = $kind
      risk_profile = $risk
    }) | Out-Null
  }

  return @($items.ToArray() | Sort-Object top, left)
}

function Get-WindowSnapshot {
  $snapshot = New-Object System.Collections.Generic.List[object]
  foreach ($window in Get-TopLevelWindows) {
    $class = [string]$window.Current.ClassName
    $name = [string]$window.Current.Name

    $kind = switch ($class) {
      'mmui::MainWindow' { 'wechat_main' }
      'mmui::RecordDetailWindow' { 'record_detail' }
      'Chrome_WidgetWin_0' {
        if ($name -eq $script:WeChatWindowName) { 'wechat_viewer' } else { 'other_chrome' }
      }
      default { $null }
    }

    if ($null -eq $kind) {
      continue
    }

    $snapshot.Add([PSCustomObject]@{
      kind = $kind
      class = $class
      name = $name
      handle = [string]$window.Current.NativeWindowHandle
      enabled = [bool]$window.Current.IsEnabled
      offscreen = [bool]$window.Current.IsOffscreen
    }) | Out-Null
  }

  return @($snapshot.ToArray())
}

try {
  Write-DiagnoseLog 'Starting diagnose-filehelper in read-only mode.'

  $windowCandidate = Find-WeChatChatWindow
  if ($null -eq $windowCandidate) {
    throw 'Could not find an interactive WeChat main chat window. Bring WeChat conversations to the foreground and rerun.'
  }

  $wechatWindow = $windowCandidate.Window
  $currentChatName = Get-CurrentChatName -Window $wechatWindow
  if ($currentChatName -ne $script:FileHelperName) {
    throw 'Current chat must already be 文件传输助手 before diagnosis. Open that chat manually and rerun.'
  }

  $messageList = Get-ChatMessageList -Window $wechatWindow
  $windowSnapshot = @(Get-WindowSnapshot)
  $visibleItems = @(Get-ChatMessageListItems -MessageList $messageList)

  $timeAnchors = @(
    $visibleItems |
      Where-Object { $_.item_type -eq 'time_anchor' -and -not [string]::IsNullOrWhiteSpace($_.name) } |
      ForEach-Object { $_.name }
  )

  $bubbleItems = @($visibleItems | Where-Object { $_.item_type -eq 'bubble' })
  $classificationCounts = [ordered]@{
    text_url = (@($bubbleItems | Where-Object { $_.classification -eq 'text_url' })).Count
    share_card = (@($bubbleItems | Where-Object { $_.classification -eq 'share_card' })).Count
    chat_record_bundle = (@($bubbleItems | Where-Object { $_.classification -eq 'chat_record_bundle' })).Count
    video = (@($bubbleItems | Where-Object { $_.classification -eq 'video' })).Count
    unknown = (@($bubbleItems | Where-Object { $_.classification -eq 'unknown' })).Count
  }

  $riskCounts = [ordered]@{
    would_open_share_card = (@($bubbleItems | Where-Object { $_.risk_profile.would_open_share_card })).Count
    would_open_bundle = (@($bubbleItems | Where-Object { $_.risk_profile.would_open_bundle })).Count
    would_use_ratio_menu_fallback = (@($bubbleItems | Where-Object { $_.risk_profile.would_use_ratio_menu_fallback })).Count
    would_use_ctrl_w_close = (@($bubbleItems | Where-Object { $_.risk_profile.would_use_ctrl_w_close })).Count
    would_use_alt_f4_close = (@($bubbleItems | Where-Object { $_.risk_profile.would_use_alt_f4_close })).Count
  }

  $windowCounts = [ordered]@{
    wechat_main = (@($windowSnapshot | Where-Object { $_.kind -eq 'wechat_main' })).Count
    record_detail = (@($windowSnapshot | Where-Object { $_.kind -eq 'record_detail' })).Count
    wechat_viewer = (@($windowSnapshot | Where-Object { $_.kind -eq 'wechat_viewer' })).Count
  }
  $singleArticleGate = Get-SingleArticleGate -WindowCounts $windowCounts -CurrentChatName $currentChatName -MessageListVisible ($null -ne $messageList) -ClassificationCounts $classificationCounts

  $visibleItems | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $visibleItemsPath -Encoding UTF8

  Write-DiagnoseLog ("Current chat: {0}" -f $currentChatName)
  Write-DiagnoseLog ("Visible time anchors: {0}" -f ($timeAnchors -join ' | '))
  Write-DiagnoseLog ("Visible bubbles: {0}" -f $bubbleItems.Count)
  Write-DiagnoseLog ("Classification counts: {0}" -f (($classificationCounts.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value }) -join ', '))
  Write-DiagnoseLog ("Risk counts: {0}" -f (($riskCounts.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value }) -join ', '))
  Write-DiagnoseLog ("Window counts: {0}" -f (($windowCounts.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value }) -join ', '))
  Write-DiagnoseLog ("Single article gate: can_enter={0}; reasons={1}" -f $singleArticleGate.can_enter_single_article_mode, ($singleArticleGate.reasons -join ' | '))
  Write-DiagnoseLog ("Visible items written to: {0}" -f $visibleItemsPath)

  $manifest = [ordered]@{
    status = 'success'
    current_chat_name = $currentChatName
    visible_time_anchors = @($timeAnchors)
    visible_bubble_count = $bubbleItems.Count
    classification_counts = $classificationCounts
    risk_counts = $riskCounts
    window_counts = $windowCounts
    single_article_gate = $singleArticleGate
    window_snapshot = @($windowSnapshot)
    visible_items_path = $visibleItemsPath
    artifact_log = $logPath
  }
  Write-RunManifest -RunContext $run -Manifest $manifest

  Write-Output 'Diagnosis complete.'
  Write-Output ("Manifest: {0}" -f $run.ManifestPath)
  Write-Output ("Visible items: {0}" -f $visibleItemsPath)
} catch {
  Write-DiagnoseLog ("ERROR: {0}" -f $_.Exception.Message)
  $manifest = [ordered]@{
    status = 'failed'
    error = $_.Exception.Message
    artifact_log = $logPath
  }
  Write-RunManifest -RunContext $run -Manifest $manifest
  throw
}
