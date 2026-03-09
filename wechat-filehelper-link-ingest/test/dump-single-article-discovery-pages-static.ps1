Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$dumpScript = Join-Path $skillRoot 'scripts/dump-single-article-discovery-pages.ps1'
$dumpText = Get-Content -Raw $dumpScript

$expectations = @(
  @{ Label = 'dump script enforces filehelper chat'; Pattern = '文件传输助手' }
  @{ Label = 'dump script can move to latest'; Pattern = 'Move-ToLatest' }
  @{ Label = 'dump script records per-page items'; Pattern = 'pages_path' }
  @{ Label = 'dump script classifies item kinds'; Pattern = 'Get-MessageItemKind' }
  @{ Label = 'dump script scrolls page up through message list'; Pattern = "Send-Keys -Keys '\{PGUP\}' -DelayMs 650" }
)

foreach ($expectation in $expectations) {
  if ($dumpText -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

$forbidden = @(
  'Ctrl\+W',
  '%\{F4\}',
  '\^l',
  '\^c',
  '复制链接'
)

foreach ($pattern in $forbidden) {
  if ($dumpText -match $pattern) {
    throw "Unexpected active link-extraction behavior remains in dump script: $pattern"
  }
}

'dump-single-article-discovery-pages static smoke passed'
