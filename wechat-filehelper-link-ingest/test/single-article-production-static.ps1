Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$scanScript = Join-Path $skillRoot 'scripts/scan-single-article-links.ps1'
$skillDoc = Join-Path $skillRoot 'SKILL.md'

$scanText = Get-Content -Raw $scanScript
$skillText = Get-Content -Raw $skillDoc

$expectations = @(
  @{ Label = 'scan script exposes time range params'; Text = $scanText; Pattern = '\[string\]\$Since' }
  @{ Label = 'scan script separates discovery and processing'; Text = $scanText; Pattern = 'Discover-SingleArticleCandidates' }
  @{ Label = 'scan script seeks latest page before discovery'; Text = $scanText; Pattern = 'Move-DiscoveryStartToLatest' }
  @{ Label = 'scan script can page down to reach latest messages'; Text = $scanText; Pattern = "Send-Keys -Keys '\{PGDN\}' -DelayMs 650" }
  @{ Label = 'scan script can wheel-scroll the message list'; Text = $scanText; Pattern = 'Wheel-ScrollAtPoint -X' }
  @{ Label = 'scan script can infer latest candidates without anchors'; Text = $scanText; Pattern = 'AllowLatestAnchorInference' }
  @{ Label = 'scan script records inferred candidate flag'; Text = $scanText; Pattern = 'time_inferred = \[bool\]\$TimeInferred' }
  @{ Label = 'scan script can skip bilibili-like messages'; Text = $scanText; Pattern = 'Test-IsBilibiliLikeMessage' }
  @{ Label = 'scan script records bilibili skips'; Text = $scanText; Pattern = 'bilibili_message_skipped' }
  @{ Label = 'scan script waits for independent viewer'; Text = $scanText; Pattern = 'Wait-ForNewViewerWindow' }
  @{ Label = 'scan script can safely clean pre-existing viewers'; Text = $scanText; Pattern = 'Attempting safe cleanup' }
  @{ Label = 'scan script checks production gate after open'; Text = $scanText; Pattern = 'WeChat main window became unstable after opening the single article viewer' }
  @{ Label = 'scan script logs unresolved extractor failures'; Text = $scanText; Pattern = 'share_card_extractor_failed' }
  @{ Label = 'skill doc exposes single article production command'; Text = $skillText; Pattern = 'scan-single-article-links\.ps1' }
)

foreach ($expectation in $expectations) {
  if ($expectation.Text -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

'single-article-production static smoke passed'
