Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$scanScript = Join-Path $skillRoot 'scripts/scan-single-article-links.ps1'
$extractScript = Join-Path $skillRoot 'scripts/extract-current-article-link.ps1'
$skillDoc = Join-Path $skillRoot 'SKILL.md'

$scanText = Get-Content -Raw $scanScript
$extractText = Get-Content -Raw $extractScript
$skillText = Get-Content -Raw $skillDoc

$expectations = @(
  @{ Label = 'scan script exposes time range params'; Text = $scanText; Pattern = '\[string\]\$Since' }
  @{ Label = 'scan script seeks latest page before streaming'; Text = $scanText; Pattern = 'Move-DiscoveryStartToLatest' }
  @{ Label = 'scan script guards against empty latest-page overshoot'; Text = $scanText; Pattern = 'empty-page overshoot' }
  @{ Label = 'scan script processes visible pages in stream mode'; Text = $scanText; Pattern = 'Process-VisiblePageCandidates' }
  @{ Label = 'scan script can page down to reach latest messages'; Text = $scanText; Pattern = "Send-Keys -Keys '\{PGDN\}' -DelayMs 650" }
  @{ Label = 'scan script can wheel-scroll the message list'; Text = $scanText; Pattern = 'Wheel-ScrollAtPoint -X' }
  @{ Label = 'scan script can infer latest candidates without anchors'; Text = $scanText; Pattern = 'AllowLatestAnchorInference' }
  @{ Label = 'scan script records inferred candidate flag'; Text = $scanText; Pattern = 'time_inferred = \[bool\]\$TimeInferred' }
  @{ Label = 'scan script computes a stable candidate message key'; Text = $scanText; Pattern = 'function Get-CandidateMessageKey' }
  @{ Label = 'scan script registers candidates with fingerprint merging'; Text = $scanText; Pattern = 'function Register-Candidate' }
  @{ Label = 'scan script tracks processed candidate keys'; Text = $scanText; Pattern = 'processedCandidateKeys = New-Object' }
  @{ Label = 'scan script de-dupes URLs during the current run'; Text = $scanText; Pattern = 'function Add-RecordIfNewUrl' }
  @{ Label = 'scan script can skip bilibili-like messages'; Text = $scanText; Pattern = 'Test-IsBilibiliLikeMessage' }
  @{ Label = 'scan script records bilibili skips'; Text = $scanText; Pattern = 'bilibili_message_skipped' }
  @{ Label = 'scan script waits for independent viewer'; Text = $scanText; Pattern = 'Wait-ForNewViewerWindow' }
  @{ Label = 'scan script detects viewer menu readiness'; Text = $scanText; Pattern = 'Find-ViewerMenuButton' }
  @{ Label = 'scan script logs open-to-viewer timing'; Text = $scanText; Pattern = 'open_to_viewer_ms=' }
  @{ Label = 'scan script logs viewer-to-menu timing'; Text = $scanText; Pattern = 'viewer_to_menu_ready_ms=' }
  @{ Label = 'scan script waits for viewer close by polling'; Text = $scanText; Pattern = 'Wait-ForViewerWindowClosed' }
  @{ Label = 'scan script logs close-viewer timing'; Text = $scanText; Pattern = 'close_viewer_ms=' }
  @{ Label = 'scan script waits for main window recovery after close'; Text = $scanText; Pattern = 'Wait-ForStableProductionGate' }
  @{ Label = 'scan script logs main-window recovery timing'; Text = $scanText; Pattern = 'main_window_recovery_ms=' }
  @{ Label = 'scan script can safely clean pre-existing viewers'; Text = $scanText; Pattern = 'Attempting safe cleanup' }
  @{ Label = 'scan script checks production gate after open'; Text = $scanText; Pattern = 'WeChat main window became unstable after opening the single article viewer' }
  @{ Label = 'scan script treats missing viewer open as recoverable'; Text = $scanText; Pattern = 'share_card_viewer_not_opened' }
  @{ Label = 'scan script logs unresolved extractor failures'; Text = $scanText; Pattern = 'share_card_extractor_failed' }
  @{ Label = 'extractor waits for viewer menu button'; Text = $extractText; Pattern = 'function Wait-ForViewerMenuButton' }
  @{ Label = 'extractor polls clipboard validation results'; Text = $extractText; Pattern = 'function Wait-ForValidationResult' }
  @{ Label = 'extractor logs viewer menu readiness timing'; Text = $extractText; Pattern = 'viewer_to_menu_ready_ms=' }
  @{ Label = 'extractor logs menu-to-clipboard timing'; Text = $extractText; Pattern = 'menu_to_clipboard_ms=' }
  @{ Label = 'skill doc exposes single article production command'; Text = $skillText; Pattern = 'scan-single-article-links\.ps1' }
)

foreach ($expectation in $expectations) {
  if ($expectation.Text -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

'single-article-production static smoke passed'
