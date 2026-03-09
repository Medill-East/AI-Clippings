Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$probeScript = Join-Path $skillRoot 'scripts/probe-current-article-menu.ps1'
$probeText = Get-Content -Raw $probeScript

$expectations = @(
  @{ Label = 'probe script declares strict mode'; Pattern = 'Set-StrictMode -Version Latest' }
  @{ Label = 'probe is read-only and exits when no viewer'; Pattern = "status = 'no_viewer'" }
  @{ Label = 'probe enumerates top-level viewer'; Pattern = "Chrome_WidgetWin_0" }
  @{ Label = 'probe enumerates descendants'; Pattern = 'Get-Descendants' }
  @{ Label = 'probe reports pattern support'; Pattern = 'Get-PatternSupport' }
  @{ Label = 'probe looks for copy link label'; Pattern = '复制链接' }
  @{ Label = 'probe outputs menu_like_items'; Pattern = 'menu_like_items' }
)

foreach ($expectation in $expectations) {
  if ($probeText -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

$forbidden = @(
  'Send-Keys',
  'Click-Point',
  'SetForegroundWindow',
  'ShowWindowAsync',
  'mouse_event'
)

foreach ($pattern in $forbidden) {
  if ($probeText -match $pattern) {
    throw "Unexpected active interaction in probe script: $pattern"
  }
}

'probe-current-article-menu static smoke passed'
