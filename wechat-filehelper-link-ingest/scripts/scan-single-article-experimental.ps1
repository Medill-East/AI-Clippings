[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Since,
  [Parameter(Mandatory = $true)]
  [string]$Until,
  [ValidateRange(1, 200)]
  [int]$MaxScrolls = 5,
  [switch]$Reindex,
  [string]$IndexPath,
  [switch]$AcknowledgeWindowMutationRisk
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $AcknowledgeWindowMutationRisk) {
  throw 'Single-article experimental mode is blocked by default because it can hide or close the WeChat main window on this machine. Re-run only with -AcknowledgeWindowMutationRisk if you explicitly want to test that behavior.'
}

$scanScript = Join-Path $PSScriptRoot 'scan-filehelper.ps1'
$invokeParams = @{
  Since = $Since
  Until = $Until
  MaxScrolls = $MaxScrolls
  SafeSingleArticleMode = $true
  SkipChatRecordBundles = $true
  EnableInteractiveArticleOpen = $true
}

if ($Reindex) {
  $invokeParams.Reindex = $true
}

if (-not [string]::IsNullOrWhiteSpace($IndexPath)) {
  $invokeParams.IndexPath = $IndexPath
}

& $scanScript @invokeParams
