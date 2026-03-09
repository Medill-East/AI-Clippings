[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Since,
  [Parameter(Mandatory = $true)]
  [string]$Until,
  [ValidateSet('text', 'json', 'md')]
  [string]$Format = 'text',
  [string]$IndexPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/common.ps1')

$skillRoot = Get-SkillRoot
$resolvedIndexPath = Get-IndexPath -SkillRoot $skillRoot -IndexPath $IndexPath
$sinceValue = ConvertTo-DateTimeOffsetSafe $Since
$untilValue = ConvertTo-DateTimeOffsetSafe $Until

if ($sinceValue -gt $untilValue) {
  throw '-Since must be earlier than or equal to -Until.'
}

$records = @(Read-JsonLinesFile -Path $resolvedIndexPath)
$filtered = if (@($records).Count -eq 0) { @() } else { @(Filter-LinkRecords -Records $records -Since $sinceValue -Until $untilValue) }

$deduped = @(
  $filtered |
    Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.url) } |
    Group-Object url |
    ForEach-Object { $_.Group[0] } |
    Sort-Object { ConvertTo-DateTimeOffsetSafe $_.message_time }, url
)

switch ($Format) {
  'json' {
    $deduped | ConvertTo-Json -Depth 8
  }
  'md' {
    if ($deduped.Count -eq 0) {
      "No links found between $($sinceValue.ToString('o')) and $($untilValue.ToString('o'))."
      break
    }

    @(
      '| Message Time | Type | Title | URL |'
      '| --- | --- | --- | --- |'
      foreach ($record in $deduped) {
        $title = if ([string]::IsNullOrWhiteSpace([string]$record.title)) { '(untitled)' } else { ([string]$record.title).Replace('|', '\|') }
        '| {0} | {1} | {2} | {3} |' -f $record.message_time, $record.message_type, $title, $record.url
      }
    ) -join [Environment]::NewLine
  }
  default {
    if ($deduped.Count -eq 0) {
      "No links found between $($sinceValue.ToString('o')) and $($untilValue.ToString('o'))."
      break
    }

    $deduped | ForEach-Object { Format-LinkRecordText $_ }
  }
}
