Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$probeScript = Join-Path $skillRoot 'scripts/open-visible-sharecard-menu-and-probe.ps1'
$probeText = Get-Content -Raw $probeScript

$expectations = @(
  @{ Label = 'probe enforces filehelper chat'; Pattern = '文件传输助手' }
  @{ Label = 'probe locates chat message list'; Pattern = 'chat_message_list' }
  @{ Label = 'probe selects bubble with selection pattern'; Pattern = 'SelectionItemPattern' }
  @{ Label = 'probe opens bubble with enter'; Pattern = "Send-Keys -Keys '\{ENTER\}' -DelayMs 320" }
  @{ Label = 'probe opens viewer menu via UIA'; Pattern = 'Find-ViewerMenuButton' }
  @{ Label = 'probe emits menu items payload'; Pattern = 'item_count' }
  @{ Label = 'probe writes menu-probe artifact'; Pattern = 'menu-probe.json' }
)

foreach ($expectation in $expectations) {
  if ($probeText -notmatch $expectation.Pattern) {
    throw "Missing expectation: $($expectation.Label)"
  }
}

$forbidden = @(
  'Ctrl\+W',
  '%\{F4\}',
  '\^l',
  '\^c'
)

foreach ($pattern in $forbidden) {
  if ($probeText -match $pattern) {
    throw "Unexpected risky interaction remains in active probe script: $pattern"
  }
}

'open-visible-sharecard-menu-and-probe static smoke passed'
