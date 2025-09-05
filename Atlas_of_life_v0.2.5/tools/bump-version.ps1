param(
  [string]$Version,
  [ValidateSet('major','minor','patch')][string]$Part = 'patch',
  [string]$Date,
  [string]$Time
)

$ErrorActionPreference = 'Stop'

function Get-CurrentVersion([string]$changelogText){
  $rx = [regex]'(?m)^(##\s+Atlas_of_life_v)(\d+)\.(\d+)\.(\d+)\b.*$'
  $m = $rx.Match($changelogText)
  if(-not $m.Success){ throw "Cannot find '## Atlas_of_life_vX.Y.Z' in CHANGELOG.md" }
  return [PSCustomObject]@{ prefix=$m.Groups[1].Value; major=[int]$m.Groups[2].Value; minor=[int]$m.Groups[3].Value; patch=[int]$m.Groups[4].Value }
}

function Bump-Version([int]$major,[int]$minor,[int]$patch,[string]$part){
  switch($part){
    'major' { $major++; $minor=0; $patch=0 }
    'minor' { $minor++; $patch=0 }
    default { $patch++ }
  }
  return "$major.$minor.$patch"
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$chPath = Join-Path $root 'CHANGELOG.md'
$appPath = Join-Path $root 'js/app.js'

$ch = Get-Content -Raw -Encoding utf8 -LiteralPath $chPath
$cur = Get-CurrentVersion $ch

if([string]::IsNullOrWhiteSpace($Version)){
  $Version = Bump-Version $cur.major $cur.minor $cur.patch $Part
}

if([string]::IsNullOrWhiteSpace($Date)){
  $Date = Get-Date -Format 'yyyy-MM-dd'
}
if([string]::IsNullOrWhiteSpace($Time)){
  $Time = Get-Date -Format 'HH:mm'
}

$token = "Atlas_of_life_v$Version"

# Insert a new version section at the top (before the first version heading), preserving history
$newHeading = "## $token - $Date $Time"
$lines = [System.Collections.Generic.List[string]]::new()
$lines.AddRange([string[]](Get-Content -LiteralPath $chPath -Encoding utf8))
$firstIdx = -1
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match '^(##\s+Atlas_of_life_v\d+\.\d+\.\d+)') { $firstIdx = $i; break }
}
if($firstIdx -ge 0){
  # rebuild file with inserted section (heading + template body)
  $before = $lines.GetRange(0, $firstIdx)
  $after  = $lines.GetRange($firstIdx, $lines.Count - $firstIdx)
  $template = @(
    $newHeading,
    '',
    'Добавлено',
    '- ',
    '',
    'Изменено',
    '- ',
    '',
    'Исправлено',
    '- ',
    ''
  )
  $combined = @()
  $combined += $before
  $combined += $template
  $combined += $after
  Set-Content -LiteralPath $chPath -Value ($combined -join [Environment]::NewLine) -Encoding utf8
} else {
  # no previous versions found — prepend near the top
  $prepend = ($newHeading + [Environment]::NewLine + [Environment]::NewLine + 'Добавлено' + [Environment]::NewLine + '- ' + [Environment]::NewLine + [Environment]::NewLine + 'Изменено' + [Environment]::NewLine + '- ' + [Environment]::NewLine + [Environment]::NewLine + 'Исправлено' + [Environment]::NewLine + '- ' + [Environment]::NewLine + [Environment]::NewLine)
  Set-Content -LiteralPath $chPath -Value ($prepend + $ch) -Encoding utf8
}

# Update app.js fallback APP_VERSION
$js = Get-Content -Raw -Encoding utf8 -LiteralPath $appPath
$rxJs = [regex]"let APP_VERSION = 'Atlas_of_life_v[^']+';"
$jsNew = $rxJs.Replace($js, "let APP_VERSION = '$token';")
if($jsNew -ne $js){ Set-Content -LiteralPath $appPath -Value $jsNew -Encoding utf8 }

Write-Host "Bumped version to" $Version
Write-Host "Updated:" (Resolve-Path $chPath).Path
Write-Host "Updated:" (Resolve-Path $appPath).Path
