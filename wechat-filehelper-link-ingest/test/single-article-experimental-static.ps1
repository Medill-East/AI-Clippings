Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $skillRoot 'scripts/scan-single-article-experimental.ps1'
$scriptText = Get-Content -Raw $scriptPath

$expectations = @(
  @{ Label = 'wrapper requires explicit risk acknowledgement'; Pattern = '\[switch\]\$AcknowledgeWindowMutationRisk' }
  @{ Label = 'wrapper blocks by default'; Pattern = 'blocked by default because it can hide or close the WeChat main window' }
  @{ Label = 'wrapper forces safe single article mode'; Pattern = 'SafeSingleArticleMode = \$true' }
  @{ Label = 'wrapper skips bundles'; Pattern = 'SkipChatRecordBundles = \$true' }
  @{ Label = 'wrapper explicitly enables interactive article open'; Pattern = 'EnableInteractiveArticleOpen = \$true' }
  @{ Label = 'wrapper forwards time range'; Pattern = 'Since = \$Since' }
  @{ Label = 'wrapper calls shared scan script'; Pattern = '& \$scanScript @invokeParams' }
)

foreach ($expectation in $expectations) {
  if ($scriptText -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

'single-article-experimental static smoke passed'
