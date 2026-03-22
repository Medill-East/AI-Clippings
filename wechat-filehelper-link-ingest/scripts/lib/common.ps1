Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SkillRoot {
  return Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

function Ensure-Directory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }

  return (Resolve-Path -LiteralPath $Path).Path
}

function ConvertTo-DateTimeOffsetSafe {
  param(
    [Parameter(Mandatory = $true)]
    [AllowNull()]
    [object]$Value
  )

  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    return $null
  }

  if ($Value -is [DateTimeOffset]) {
    return $Value
  }

  if ($Value -is [DateTime]) {
    return [DateTimeOffset]::new($Value)
  }

  return [DateTimeOffset]::Parse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-CanonicalUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    $uri = [System.Uri]$Url
  } catch {
    return $null
  }

  if (-not $uri.IsAbsoluteUri) {
    return $null
  }

  $builder = [System.UriBuilder]::new($uri)
  $builder.Host = $builder.Host.ToLowerInvariant()
  $builder.Fragment = ''
  if (($builder.Scheme -eq 'http' -and $builder.Port -eq 80) -or ($builder.Scheme -eq 'https' -and $builder.Port -eq 443)) {
    $builder.Port = -1
  }

  $canonical = $builder.Uri.AbsoluteUri
  if ($canonical.EndsWith('/')) {
    return $canonical.TrimEnd('/')
  }

  return $canonical
}

function Get-UrlMatchesFromText {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Text
  )

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return @()
  }

  $regex = [regex]'https?://[^\s<>"''\u3002\uff0c\uff1b\uff01\uff1f\)\]]+'
  $matches = $regex.Matches($Text)
  $urls = New-Object System.Collections.Generic.List[string]
  foreach ($match in $matches) {
    $candidate = $match.Value.Trim()
    $candidate = $candidate.TrimEnd('.', ',', ';', '!', '?', ')', ']', '>', '"', "'")
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      $urls.Add($candidate) | Out-Null
    }
  }

  return $urls.ToArray()
}

function New-DedupeKey {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ChatName,
    [Parameter(Mandatory = $true)]
    [AllowNull()]
    [string]$MessageTime,
    [Parameter(Mandatory = $true)]
    [string]$CanonicalUrl
  )

  $safeMessageTime = if ($null -eq $MessageTime) { '' } else { [string]$MessageTime }
  $seed = '{0}|{1}|{2}' -f $ChatName.Trim(), $safeMessageTime, $CanonicalUrl.Trim()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($seed))
  } finally {
    $sha.Dispose()
  }

  return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
}

function New-RunContext {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CommandName,
    [AllowNull()]
    [string]$SkillRoot
  )

  if ([string]::IsNullOrWhiteSpace($SkillRoot)) {
    $SkillRoot = Get-SkillRoot
  }

  $timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $runRoot = Ensure-Directory (Join-Path $SkillRoot "local/runs/$timestamp")
  $artifactDir = Ensure-Directory (Join-Path $runRoot 'artifacts')
  $manifestPath = Join-Path $runRoot 'manifest.json'
  $sessionId = [guid]::NewGuid().ToString()

  return [PSCustomObject]@{
    CommandName = $CommandName
    SkillRoot = $SkillRoot
    RunRoot = $runRoot
    ArtifactDir = $artifactDir
    ManifestPath = $manifestPath
    SessionId = $sessionId
    StartedAt = [DateTimeOffset]::Now
  }
}

function Write-RunManifest {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$RunContext,
    [Parameter(Mandatory = $true)]
    [hashtable]$Manifest
  )

  $payload = [ordered]@{
    command_name = $RunContext.CommandName
    capture_session_id = $RunContext.SessionId
    started_at = $RunContext.StartedAt.ToString('o')
    finished_at = [DateTimeOffset]::Now.ToString('o')
  }

  foreach ($key in $Manifest.Keys) {
    $payload[$key] = $Manifest[$key]
  }

  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RunContext.ManifestPath -Encoding UTF8
}

function Get-IndexPath {
  param(
    [AllowNull()]
    [string]$SkillRoot,
    [AllowNull()]
    [string]$IndexPath
  )

  if (-not [string]::IsNullOrWhiteSpace($IndexPath)) {
    $parent = Split-Path -Parent $IndexPath
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
      Ensure-Directory $parent | Out-Null
    }
    return $IndexPath
  }

  if ([string]::IsNullOrWhiteSpace($SkillRoot)) {
    $SkillRoot = Get-SkillRoot
  }

  Ensure-Directory (Join-Path $SkillRoot 'local/index') | Out-Null
  return (Join-Path $SkillRoot 'local/index/links.jsonl')
}

function Read-JsonLinesFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($line in [System.IO.File]::ReadLines($Path)) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }
    $records.Add(($line | ConvertFrom-Json)) | Out-Null
  }

  return $records.ToArray()
}

function Write-JsonLinesFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [object[]]$Records
  )

  $lines = foreach ($record in $Records) {
    $record | ConvertTo-Json -Depth 8 -Compress
  }

  [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

function Merge-IndexRecords {
  param(
    [Parameter(Mandatory = $true)]
    [string]$IndexPath,
    [Parameter(Mandatory = $true)]
    [object[]]$IncomingRecords,
    [switch]$Reindex
  )

  $existing = @()
  if (-not $Reindex) {
    $existing = @(Read-JsonLinesFile -Path $IndexPath)
  }

  $map = [ordered]@{}
  foreach ($record in $existing) {
    if ($null -ne $record.dedupe_key) {
      $map[[string]$record.dedupe_key] = $record
    }
  }

  $added = 0
  foreach ($record in $IncomingRecords) {
    $key = [string]$record.dedupe_key
    if (-not $map.Contains($key)) {
      $map[$key] = $record
      $added++
    }
  }

  $merged = @($map.Values | Sort-Object { ConvertTo-DateTimeOffsetSafe $_.message_time }, url)
  Write-JsonLinesFile -Path $IndexPath -Records $merged

  return [PSCustomObject]@{
    total = $merged.Count
    added = $added
    skipped = $IncomingRecords.Count - $added
  }
}

function Filter-LinkRecords {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Records,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$Since,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$Until
  )

  return @(
    $Records |
      Where-Object {
        $when = ConvertTo-DateTimeOffsetSafe $_.message_time
        if ($null -eq $when) {
          return $false
        }
        return $when -ge $Since -and $when -le $Until
      } |
      Sort-Object { ConvertTo-DateTimeOffsetSafe $_.message_time }, url
  )
}

function Format-LinkRecordText {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Record
  )

  $title = if ([string]::IsNullOrWhiteSpace([string]$Record.title)) { '(untitled)' } else { [string]$Record.title }
  return '{0} | {1} | {2} | {3}' -f $Record.message_time, $Record.message_type, $title, $Record.url
}

function Resolve-WeChatTimestamp {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$RawText,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$Fallback,
    [AllowNull()]
    [object]$CurrentDayAnchor
  )

  $text = if ($null -eq $RawText) { '' } else { [string]$RawText }
  $text = $text.Trim()
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $Fallback
  }

  if ($text -match '^(?<h>\d{1,2}):(?<m>\d{2})$') {
    $anchor = if ($null -ne $CurrentDayAnchor) { $CurrentDayAnchor } else { $Fallback }
    try {
      return [DateTimeOffset]::new($anchor.Year, $anchor.Month, $anchor.Day, [int]$Matches.h, [int]$Matches.m, 0, $anchor.Offset)
    } catch {
      return $Fallback
    }
  }

  if ($text -match '^(?<dayLabel>[^\d\s]{1,4})\s*(?<h>\d{1,2}):(?<m>\d{2})$') {
    $anchor = $Fallback
    if ($Matches.dayLabel -eq $script:YesterdayLabel) {
      $anchor = [DateTimeOffset]::Now.AddDays(-1)
    } elseif ($Matches.dayLabel -eq $script:TodayLabel) {
      $anchor = [DateTimeOffset]::Now
    } elseif ($null -ne $CurrentDayAnchor) {
      $anchor = $CurrentDayAnchor
    }
    try {
      return [DateTimeOffset]::new($anchor.Year, $anchor.Month, $anchor.Day, [int]$Matches.h, [int]$Matches.m, 0, $anchor.Offset)
    } catch {
      return $Fallback
    }
  }

  if ($text -match '^(?<month>\d{1,2})\D(?<day>\d{1,2})\D\s*(?<h>\d{1,2}):(?<m>\d{2})$') {
    try {
      return [DateTimeOffset]::new($Fallback.Year, [int]$Matches.month, [int]$Matches.day, [int]$Matches.h, [int]$Matches.m, 0, $Fallback.Offset)
    } catch {
      return $Fallback
    }
  }

  if ($text -match '^(?<year>\d{4})\D(?<month>\d{1,2})\D(?<day>\d{1,2})\D(?:\s*(?<h>\d{1,2}):(?<m>\d{2}))?$') {
    $hour = if ($Matches.ContainsKey('h') -and $Matches.h) { [int]$Matches.h } else { 0 }
    $minute = if ($Matches.ContainsKey('m') -and $Matches.m) { [int]$Matches.m } else { 0 }
    try {
      return [DateTimeOffset]::new([int]$Matches.year, [int]$Matches.month, [int]$Matches.day, $hour, $minute, 0, $Fallback.Offset)
    } catch {
      return $Fallback
    }
  }

  try {
    return ConvertTo-DateTimeOffsetSafe $text
  } catch {
    return $Fallback
  }
}
