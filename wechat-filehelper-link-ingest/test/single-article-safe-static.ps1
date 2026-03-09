Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$scanScript = Join-Path $skillRoot 'scripts/scan-single-article-links.ps1'
$extractScript = Join-Path $skillRoot 'scripts/extract-current-article-link.ps1'
$scanText = Get-Content -Raw $scanScript
$extractText = Get-Content -Raw $extractScript

$expectations = @(
  @{ Label = 'production scanner exists'; Text = $scanText; Pattern = 'scan-single-article-links' }
  @{ Label = 'production scanner only processes candidates by kind'; Text = $scanText; Pattern = "text_url', 'share_card'" }
  @{ Label = 'production scanner writes candidates artifact'; Text = $scanText; Pattern = 'candidates.json' }
  @{ Label = 'production scanner uses production gate'; Text = $scanText; Pattern = 'Assert-ProductionGate' }
  @{ Label = 'production scanner opens share cards with selection plus enter'; Text = $scanText; Pattern = "Send-Keys -Keys '\{ENTER\}' -DelayMs 300" }
  @{ Label = 'production scanner invokes extractor via structured input'; Text = $scanText; Pattern = 'InputJsonPath' }
  @{ Label = 'production scanner closes viewer with safe UIA helper'; Text = $scanText; Pattern = 'Close-ViewerWindowGracefully' }
  @{ Label = 'extract supports structured input'; Text = $extractText; Pattern = '\[string\]\$InputJsonPath' }
  @{ Label = 'extract supports browser fallback flag'; Text = $extractText; Pattern = '\[switch\]\$AllowBrowserFallback' }
  @{ Label = 'extract has enter-based menu action helper'; Text = $extractText; Pattern = 'function Try-ActivateMenuActionWithEnter' }
  @{ Label = 'extract has keyboard menu navigation helper'; Text = $extractText; Pattern = 'function Try-ActivateMenuActionByKeyboardNavigation' }
  @{ Label = 'extract uses menu navigation index for copy link'; Text = $extractText; Pattern = '\$script:MenuNavigationIndex' }
  @{ Label = 'extract maps copy link to six downs'; Text = $extractText; Pattern = '\$script:CopyLinkLabel = 6' }
  @{ Label = 'extract maps open in browser to four downs'; Text = $extractText; Pattern = '\$script:OpenInBrowserLabel = 4' }
  @{ Label = 'extract prefers keyboard navigation for mapped actions'; Text = $extractText; Pattern = '\$script:MenuNavigationIndex\.ContainsKey\(\$ActionLabel\)' }
  @{ Label = 'extract uses direct-down navigation log'; Text = $extractText; Pattern = 'Using direct-down keyboard navigation' }
  @{ Label = 'extract confirms menu action with enter'; Text = $extractText; Pattern = "Send-Keys -Keys '\{ENTER\}' -DelayMs 260" }
  @{ Label = 'extract can move down through menu items'; Text = $extractText; Pattern = "Send-Keys -Keys '\{DOWN\}' -DelayMs 90" }
  @{ Label = 'extract reads browser via changed-window snapshot'; Text = $extractText; Pattern = 'Get-BrowserSnapshot' }
  @{ Label = 'extract no longer uses ratio fallback'; Text = $extractText; Pattern = 'Try-InvokeMenuActionByUiAutomation' }
)

foreach ($expectation in $expectations) {
  if ($expectation.Text -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

$forbidden = @(
  'Invoke-MenuActionByRatio',
  'ShowWindowAsync\(\$handle, 5\)',
  'Ctrl\+W',
  '%\{F4\}'
)

foreach ($pattern in $forbidden) {
  if ($extractText -match $pattern) {
    throw "Unexpected legacy interaction remains in extractor: $pattern"
  }
}

'single-article-safe static smoke passed'
