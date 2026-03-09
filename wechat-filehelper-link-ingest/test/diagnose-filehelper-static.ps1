Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$diagnoseScript = Join-Path $skillRoot 'scripts/diagnose-filehelper.ps1'
$scanScript = Join-Path $skillRoot 'scripts/scan-filehelper.ps1'
$extractScript = Join-Path $skillRoot 'scripts/extract-current-article-link.ps1'

$diagnoseText = Get-Content -Raw $diagnoseScript
$scanText = Get-Content -Raw $scanScript
$extractText = Get-Content -Raw $extractScript

$expectations = @(
  @{ Label = 'diagnose script exists'; Text = $diagnoseText; Pattern = 'Starting diagnose-filehelper in read-only mode' }
  @{ Label = 'diagnose reads chat_message_list directly'; Text = $diagnoseText; Pattern = 'chat_message_list' }
  @{ Label = 'diagnose keeps direct list item filtering'; Text = $diagnoseText; Pattern = "mmui::ChatBubbleItemView', 'mmui::ChatItemView" }
  @{ Label = 'diagnose classifies bubble types'; Text = $diagnoseText; Pattern = 'Get-MessageItemKind' }
  @{ Label = 'diagnose records risk counts'; Text = $diagnoseText; Pattern = 'would_use_ctrl_w_close' }
  @{ Label = 'diagnose records single article gate'; Text = $diagnoseText; Pattern = 'Get-SingleArticleGate' }
  @{ Label = 'diagnose writes single article gate into manifest'; Text = $diagnoseText; Pattern = 'single_article_gate' }
  @{ Label = 'diagnose writes visible-items json'; Text = $diagnoseText; Pattern = 'visible-items.json' }
  @{ Label = 'scan still contains ctrl-w close risk'; Text = $scanText; Pattern = "Send-Keys -Keys '\^w'" }
  @{ Label = 'scan still contains alt-f4 detail close risk'; Text = $scanText; Pattern = "Send-Keys -Keys '%\{F4\}'" }
  @{ Label = 'extract still contains browser fallback'; Text = $extractText; Pattern = 'Try-OpenInDefaultBrowser' }
)

foreach ($expectation in $expectations) {
  if ($expectation.Text -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

$forbidden = @(
  'Send-Keys -Keys ''\^w''',
  'Send-Keys -Keys ''%\{F4\}''',
  'Send-Keys -Keys ''\^l''',
  'Send-Keys -Keys ''\^c''',
  'Send-Keys -Keys ''\{PGUP\}''',
  'SetCursorPos',
  'mouse_event',
  'Try-OpenInDefaultBrowser',
  'Invoke-MenuActionByRatio'
)

foreach ($pattern in $forbidden) {
  if ($diagnoseText -match $pattern) {
    throw "Unexpected active interaction remains in diagnose script: $pattern"
  }
}

'diagnose-filehelper static smoke passed'
