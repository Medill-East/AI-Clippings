Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $PSScriptRoot 'fixtures/links.sample.jsonl'
$tempRoot = Join-Path $env:TEMP ('wechat-filehelper-link-ingest-test-' + [guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $tempRoot -Force
$indexPath = Join-Path $tempRoot 'links.jsonl'
Copy-Item -LiteralPath $fixture -Destination $indexPath -Force

$cmd = Join-Path $skillRoot 'scripts/query-links.ps1'
$output = & powershell -ExecutionPolicy Bypass -File $cmd -Since '2026-03-08T09:00:00+08:00' -Until '2026-03-08T10:00:00+08:00' -Format text -IndexPath $indexPath

if ($LASTEXITCODE -ne 0) {
  throw 'query-links.ps1 exited with a non-zero code.'
}

if (($output | Measure-Object).Count -ne 2) {
  throw "Expected 2 unique lines, got $((($output | Measure-Object).Count))."
}

if (-not ($output -match 'https://platform.openai.com/docs')) {
  throw 'Expected OpenAI docs URL in the output.'
}

if (-not ($output -match 'https://mp.weixin.qq.com/s/example')) {
  throw 'Expected WeChat article URL in the output.'
}

Remove-Item -LiteralPath $tempRoot -Recurse -Force
Write-Output 'query-links smoke test passed.'
