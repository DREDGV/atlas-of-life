param(
  [Parameter(Mandatory=$true)]
  [string]$Version,
  [switch]$Tag
)

# Update CHANGELOG.md: move the 'Unreleased' section under the new version and date.
$filePath = Join-Path (Get-Location) "CHANGELOG.md"
if (-not (Test-Path $filePath)) {
  Write-Error "CHANGELOG.md not found in current directory."
  exit 1
}

$content = Get-Content $filePath -Raw
$date = Get-Date -UFormat "%Y-%m-%d"
$pattern = '## \[Unreleased\]'
$replacement = "## [Unreleased]`r`n`r`n## [$Version] - $date"
$updated = [regex]::Replace($content, $pattern, $replacement, 1)
Set-Content -Path $filePath -Value $updated

if ($Tag) {
  try {
    git tag "v$Version"
  } catch {
    Write-Warning "Git tagging failed. Ensure this is a git repository and git is installed."
  }
}