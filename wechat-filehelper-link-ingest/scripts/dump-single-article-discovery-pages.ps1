[CmdletBinding()]
param(
  [ValidateRange(1, 200)]
  [int]$MaxScrolls = 20
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
public static class WeChatDiscoveryDumpNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@

$skillRoot = Get-SkillRoot
$run = New-RunContext -CommandName 'dump-single-article-discovery-pages' -SkillRoot $skillRoot
$logPath = Join-Path $run.ArtifactDir 'dump.log'
$dumpPath = Join-Path $run.ArtifactDir 'pages.json'
$script:FileHelperName = ([char]0x6587)+([char]0x4EF6)+([char]0x4F20)+([char]0x8F93)+([char]0x52A9)+([char]0x624B)
$script:ChatRecordLabel = ([char]0x804A)+([char]0x5929)+([char]0x8BB0)+([char]0x5F55)
$script:LinkPrefix = '[' + (([char]0x94FE)+([char]0x63A5)) + ']'
$script:VideoMarker = ([char]0x89C6)+([char]0x9891)+([char]0x53F7)

function Write-DumpLog {
  param([string]$Message)
  $line = '[{0}] {1}' -f ([DateTimeOffset]::Now.ToString('o')), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Get-TopLevelWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  return @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
}

function Get-Descendants {
  param([Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$Root)
  return @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
}

function Focus-AutomationWindow {
  param([AllowNull()][System.Windows.Automation.AutomationElement]$Window)
  if ($null -eq $Window) { return }
  $handle = [IntPtr]$Window.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero) { return }
  if ([WeChatDiscoveryDumpNative]::IsIconic($handle)) {
    [WeChatDiscoveryDumpNative]::ShowWindowAsync($handle, 9) | Out-Null
    Start-Sleep -Milliseconds 150
  }
  [WeChatDiscoveryDumpNative]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 250
}

function Send-Keys {
  param([Parameter(Mandatory = $true)][string]$Keys, [int]$DelayMs = 350)
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $DelayMs
}

function Click-Point {
  param([Parameter(Mandatory = $true)][int]$X, [Parameter(Mandatory = $true)][int]$Y)
  [WeChatDiscoveryDumpNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 60
  [WeChatDiscoveryDumpNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [WeChatDiscoveryDumpNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
}

function Get-WeChatMainWindow {
  $candidates = New-Object System.Collections.Generic.List[object]
  foreach ($window in Get-TopLevelWindows) {
    if ([string]$window.Current.ClassName -ne 'mmui::MainWindow') { continue }
    $score = 8
    $chatList = $window.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_list'))
    )
    if ($null -ne $chatList) { $score += 4 }
    $candidates.Add([PSCustomObject]@{ Window = $window; Score = $score }) | Out-Null
  }
  return $candidates | Sort-Object Score -Descending | Select-Object -First 1 -ExpandProperty Window
}

function Get-CurrentChatName {
  param([Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$Window)
  foreach ($element in Get-Descendants -Root $Window) {
    if ([string]$element.Current.AutomationId -match 'current_chat_name_label') {
      return ([string]$element.Current.Name).Trim()
    }
  }
  return ''
}

function Get-ChatMessageList {
  param([Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$Window)
  return $Window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'chat_message_list'))
  )
}

function Get-ElementRectangle {
  param([Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$Element)
  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { return $null }
  return [PSCustomObject]@{
    Left = [int][Math]::Round($rect.Left, 0)
    Top = [int][Math]::Round($rect.Top, 0)
    Width = [int][Math]::Round($rect.Width, 0)
    Height = [int][Math]::Round($rect.Height, 0)
  }
}

function Get-ChatMessageListItems {
  param([Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$MessageList)
  $items = New-Object System.Collections.Generic.List[object]
  $children = @($MessageList.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
  foreach ($element in $children) {
    $class = [string]$element.Current.ClassName
    if ($class -notin @('mmui::ChatBubbleItemView', 'mmui::ChatItemView')) { continue }
    $rect = Get-ElementRectangle -Element $element
    if ($null -eq $rect) { continue }
    $items.Add([PSCustomObject]@{
      Element = $element
      ClassName = $class
      Name = [string]$element.Current.Name
      Top = $rect.Top
      Left = $rect.Left
      Width = $rect.Width
      Height = $rect.Height
    }) | Out-Null
  }
  return @($items | Sort-Object Top, Left)
}

function Get-TextFingerprint {
  param([AllowEmptyString()][string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text.Trim())
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-MessageItemKind {
  param([AllowEmptyString()][string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) { return 'unknown' }
  if ($Name -like "*$($script:VideoMarker)*") { return 'video' }
  if ($Name -match 'https?://') { return 'text_url' }
  if ($Name -match ('^' + [regex]::Escape($script:ChatRecordLabel)) -and $Name -match [regex]::Escape($script:LinkPrefix)) { return 'chat_record_bundle' }
  if ($Name -match [regex]::Escape($script:LinkPrefix)) { return 'share_card' }
  return 'unknown'
}

function Scroll-MessageListPageUp {
  param(
    [Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$Window,
    [Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$MessageList
  )
  Focus-AutomationWindow -Window $Window
  $rect = Get-ElementRectangle -Element $MessageList
  if ($null -ne $rect) {
    Click-Point -X ($rect.Left + [Math]::Max(80, [int]($rect.Width / 2))) -Y ($rect.Top + [Math]::Max(80, [int]($rect.Height / 2)))
  }
  Send-Keys -Keys '{PGUP}' -DelayMs 650
}

function Scroll-MessageListPageDown {
  param(
    [Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$Window,
    [Parameter(Mandatory = $true)][System.Windows.Automation.AutomationElement]$MessageList
  )
  Focus-AutomationWindow -Window $Window
  $rect = Get-ElementRectangle -Element $MessageList
  if ($null -ne $rect) {
    Click-Point -X ($rect.Left + [Math]::Max(80, [int]($rect.Width / 2))) -Y ($rect.Top + [Math]::Max(80, [int]($rect.Height / 2)))
  }
  Send-Keys -Keys '{PGDN}' -DelayMs 650
}

function Move-ToLatest {
  $seenPageKeys = New-Object 'System.Collections.Generic.HashSet[string]'
  $stablePages = 0
  $seekScrollLimit = [Math]::Max($MaxScrolls, 40)
  for ($seekIndex = 0; $seekIndex -lt $seekScrollLimit; $seekIndex++) {
    $mainWindow = Get-WeChatMainWindow
    $messageList = Get-ChatMessageList -Window $mainWindow
    $visibleItems = @(Get-ChatMessageListItems -MessageList $messageList)
    $pageSignature = ($visibleItems | ForEach-Object { '{0}|{1}|{2}' -f $_.ClassName, $_.Top, (Get-TextFingerprint -Text $_.Name) }) -join ';'
    if (-not $seenPageKeys.Add($pageSignature)) {
      $stablePages++
    } else {
      $stablePages = 0
    }
    if ($stablePages -ge 2) { return }
    if ($seekIndex -lt ($seekScrollLimit - 1)) {
      Scroll-MessageListPageDown -Window $mainWindow -MessageList $messageList
    }
  }
}

$mainWindow = Get-WeChatMainWindow
if ($null -eq $mainWindow) { throw 'Could not find an interactive WeChat main window.' }
$chatName = Get-CurrentChatName -Window $mainWindow
if ($chatName -ne $script:FileHelperName) { throw 'Current chat must already be 文件传输助手 before discovery dump.' }

Move-ToLatest

$pages = New-Object System.Collections.Generic.List[object]
$seenPageKeys = New-Object 'System.Collections.Generic.HashSet[string]'
for ($scrollIndex = 0; $scrollIndex -lt $MaxScrolls; $scrollIndex++) {
  $mainWindow = Get-WeChatMainWindow
  $messageList = Get-ChatMessageList -Window $mainWindow
  if ($null -eq $messageList) { throw 'chat_message_list disappeared during dump.' }
  $visibleItems = @(Get-ChatMessageListItems -MessageList $messageList)
  $pageSignature = ($visibleItems | ForEach-Object { '{0}|{1}|{2}' -f $_.ClassName, $_.Top, (Get-TextFingerprint -Text $_.Name) }) -join ';'
  $isNewPage = $seenPageKeys.Add($pageSignature)
  $page = [ordered]@{
    scroll_index = $scrollIndex
    is_new_page = $isNewPage
    items = @(
      $visibleItems | ForEach-Object {
        [ordered]@{
          class = $_.ClassName
          top = $_.Top
          left = $_.Left
          width = $_.Width
          height = $_.Height
          kind = Get-MessageItemKind -Name $_.Name
          name = $_.Name
        }
      }
    )
  }
  $pages.Add($page) | Out-Null
  Write-DumpLog ("Captured discovery page {0} with {1} visible items." -f $scrollIndex, $visibleItems.Count)
  if (-not $isNewPage -and $scrollIndex -ge 2) { break }
  if ($scrollIndex -lt ($MaxScrolls - 1)) {
    Scroll-MessageListPageUp -Window $mainWindow -MessageList $messageList
  }
}

$pagesJson = @($pages.ToArray()) | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $dumpPath -Value $pagesJson -Encoding UTF8
$manifest = [ordered]@{
  status = 'success'
  current_chat_name = $chatName
  pages_path = $dumpPath
  artifact_log = $logPath
  page_count = $pages.Count
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $run.ManifestPath -Encoding UTF8
Write-Output $pagesJson
