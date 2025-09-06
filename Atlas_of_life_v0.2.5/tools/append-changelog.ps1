param()

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  try { (git rev-parse --show-toplevel).Trim() } catch { $null }
}

$root = Get-RepoRoot
if (-not $root) { return }

$chPath = Join-Path $root 'CHANGELOG.md'
if (-not (Test-Path -LiteralPath $chPath)) { return }

$subject = try { (git log -1 --pretty='%s').Trim() } catch { '' }
$hash    = try { (git rev-parse --short HEAD).Trim() } catch { '' }
if ([string]::IsNullOrWhiteSpace($subject)) { return }

$entry = "- $subject ($hash)"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.AddRange([string[]](Get-Content -LiteralPath $chPath -Encoding utf8))

# Skip if already present
if ($lines -match "\($([regex]::Escape($hash))\)") { return }

# Find or create 'Unreleased' section
$idx = -1
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match '^\s*##\s+\[Unreleased\]'){ $idx = $i; break }
}
if($idx -lt 0){
  $lines.Insert(0, '')
  $lines.Insert(0, '## [Unreleased]')
  $idx = 0
}

# Insert just below the heading (skip one empty line if present)
$insertAt = [Math]::Min($idx + 1, $lines.Count)
if ($insertAt -lt $lines.Count -and $lines[$insertAt] -match '^\s*$') { $insertAt++ }

$lines.Insert($insertAt, $entry)
Set-Content -LiteralPath $chPath -Value $lines -Encoding utf8

