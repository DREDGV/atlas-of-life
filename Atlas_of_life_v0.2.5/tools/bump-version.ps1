param(
  [string]$Version,
  [ValidateSet('major','minor','patch')][string]$Part = 'patch',
  [string]$Date,
  [string]$Time,
  [switch]$Tag
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
$newHeading = "## $token - $Date $Time"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.AddRange([string[]](Get-Content -LiteralPath $chPath -Encoding utf8))

# Extract [Unreleased] block if present
$uIdx = -1
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match '^\s*##\s+\[Unreleased\]'){ $uIdx = $i; break }
}
$uBlock = @()
if($uIdx -ge 0){
  $uEnd = $lines.Count
  for($j = $uIdx + 1; $j -lt $lines.Count; $j++){
    if($lines[$j] -match '^\s*##\s+') { $uEnd = $j; break }
  }
  $count = $uEnd - ($uIdx + 1)
  if($count -gt 0){ $uBlock = $lines.GetRange($uIdx + 1, $count) }
  # Trim leading/trailing empty lines
  while($uBlock.Count -gt 0 -and $uBlock[0] -match '^\s*$'){ $uBlock.RemoveAt(0) }
  while($uBlock.Count -gt 0 -and $uBlock[$uBlock.Count-1] -match '^\s*$'){ $uBlock.RemoveAt($uBlock.Count-1) }
  # Remove original block; keep the heading and one empty line under it
  if($count -gt 0){ $lines.RemoveRange($uIdx + 1, $count) }
  if(($uIdx + 1) -ge $lines.Count -or -not ($lines[$uIdx + 1] -match '^\s*$')){ $lines.Insert($uIdx + 1, '') }
}

# Find the first version heading position
$firstIdx = -1
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match '^(##\s+Atlas_of_life_v\d+\.\d+\.\d+)') { $firstIdx = $i; break }
}

# Compose new section
if($uBlock.Count -eq 0){
  $section = @(
    $newHeading,
    '',
    '### Добавлено',
    '- ',
    '',
    '### Изменено',
    '- ',
    '',
    '### Исправлено',
    '- ',
    ''
  )
} else {
  $section = @($newHeading, '') + @($uBlock) + @('')
}

if($firstIdx -ge 0){
  $before = $lines.GetRange(0, $firstIdx)
  $after  = $lines.GetRange($firstIdx, $lines.Count - $firstIdx)
  $combined = @()
  $combined += $before
  $combined += $section
  $combined += $after
  Set-Content -LiteralPath $chPath -Value ($combined -join [Environment]::NewLine) -Encoding utf8
} else {
  # No previous version headings; put near the top
  $prepend = ($section -join [Environment]::NewLine) + [Environment]::NewLine
  Set-Content -LiteralPath $chPath -Value ($prepend + $ch) -Encoding utf8
}

# Update app.js fallback APP_VERSION
$js = Get-Content -Raw -Encoding utf8 -LiteralPath $appPath
$rxJs = [regex]"let APP_VERSION = 'Atlas_of_life_v[^']+';"
$jsNew = $rxJs.Replace($js, "let APP_VERSION = '$token';")
if($jsNew -ne $js){ Set-Content -LiteralPath $appPath -Value $jsNew -Encoding utf8 }

# Optional git tag
if ($Tag) {
  try { git tag "v$Version" } catch { Write-Warning "Git tagging failed. Ensure this is a git repository and git is installed." }
}

Write-Host "Bumped version to" $Version
Write-Host "Updated:" (Resolve-Path $chPath).Path
Write-Host "Updated:" (Resolve-Path $appPath).Path

