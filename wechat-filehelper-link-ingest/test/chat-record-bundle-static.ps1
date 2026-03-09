Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$scanScript = Join-Path $skillRoot 'scripts/scan-filehelper.ps1'
$extractScript = Join-Path $skillRoot 'scripts/extract-current-article-link.ps1'
$queryScript = Join-Path $skillRoot 'scripts/query-links.ps1'

$scanText = Get-Content -Raw $scanScript
$extractText = Get-Content -Raw $extractScript
$queryText = Get-Content -Raw $queryScript
$shareCardFunction = [regex]::Match($scanText, 'function Try-CaptureShareCardUrl \{[\s\S]*?\n\}', [System.Text.RegularExpressions.RegexOptions]::Singleline).Value

$expectations = @(
  @{ Label = 'scan handles chat_record_bundle'; Text = $scanText; Pattern = "chat_record_bundle" }
  @{ Label = 'scan opens RecordDetailWindow'; Text = $scanText; Pattern = "RecordDetailWindow" }
  @{ Label = 'scan keeps bubble and time list items'; Text = $scanText; Pattern = "mmui::ChatBubbleItemView', 'mmui::ChatItemView" }
  @{ Label = 'scan reads chat_message_list directly'; Text = $scanText; Pattern = "chat_message_list" }
  @{ Label = 'scan uses direct chat list items'; Text = $scanText; Pattern = "Get-ChatMessageListItems" }
  @{ Label = 'scan creates synthetic cluster from message items'; Text = $scanText; Pattern = "New-SyntheticClusterFromMessageItem" }
  @{ Label = 'scan classifies message item kinds'; Text = $scanText; Pattern = "Get-MessageItemKind" }
  @{ Label = 'scan converts message items directly'; Text = $scanText; Pattern = "Convert-MessageItemToRecords" }
  @{ Label = 'scan requires current chat already selected'; Text = $scanText; Pattern = "Current chat must already be" }
  @{ Label = 'scan has UIA activation helper'; Text = $scanText; Pattern = "Try-ActivateUiElement" }
  @{ Label = 'scan has bundle-specific activation helper'; Text = $scanText; Pattern = "Try-ActivateBundleBubble" }
  @{ Label = 'scan uses bubble clickable point'; Text = $scanText; Pattern = "GetClickablePoint\(\)" }
  @{ Label = 'scan records bundle activation failures precisely'; Text = $scanText; Pattern = "bundle_not_activatable" }
  @{ Label = 'scan confirms viewer change for share cards'; Text = $scanText; Pattern = "Share card fallback did not confirm a viewer change; skipping URL capture\." }
  @{ Label = 'scan confirms viewer change for detail items'; Text = $scanText; Pattern = "Detail item click did not switch the viewer" }
  @{ Label = 'scan closes only confirmed viewer windows'; Text = $scanText; Pattern = "Close-WeChatViewerWindow" }
  @{ Label = 'scan records unresolved reason stats'; Text = $scanText; Pattern = "unresolved_reasons" }
  @{ Label = 'scan calls article extractor with title fragment'; Text = $scanText; Pattern = "ExpectedTitleFragment" }
  @{ Label = 'extract script supports ExpectedTitleFragment'; Text = $extractText; Pattern = "ExpectedTitleFragment" }
  @{ Label = 'extract script has default-browser fallback'; Text = $extractText; Pattern = "Try-OpenInDefaultBrowser" }
  @{ Label = 'extract script has UIA menu action helper'; Text = $extractText; Pattern = "Try-InvokeMenuActionByUiAutomation" }
  @{ Label = 'extract script looks for viewer menu button'; Text = $extractText; Pattern = "Find-ViewerMenuButton" }
  @{ Label = 'extract script verifies menu state before action'; Text = $extractText; Pattern = "Get-MenuProbeHash" }
  @{ Label = 'query dedupes by url'; Text = $queryText; Pattern = "Group-Object url" }
)

foreach ($expectation in $expectations) {
  if ($expectation.Text -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

if ($scanText -match 'falling back to bubble center') {
  throw 'Unexpected bundle center-click fallback remains in scan script.'
}

if ($shareCardFunction -match "Send-Keys -Keys '\^w'") {
  throw 'Unexpected raw Ctrl+W remains inside Try-CaptureShareCardUrl.'
}

if ($scanText -match 'Trying to switch chat through Ctrl\+F search') {
  throw 'Unexpected automatic Ctrl+F chat switching remains in scan script.'
}

if ($scanText -match 'function Get-ForegroundWindowUrl') {
  throw 'Unexpected foreground-window URL fallback remains in scan script.'
}

if ($scanText -match 'Group-MessageClusters -Elements') {
  throw 'Unexpected cluster-based scan loop remains in scan script.'
}

'chat-record-bundle static smoke passed'
