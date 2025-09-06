param(
  [Parameter(Mandatory=$true)]
  [string]$Version
)

# Replace version string in UI and other relevant files
$patterns = @(
  'Atlas of life — v\d+\.\d+\.\d+',
  'Atlas_of_life_v\d+\.\d+\.\d+'
)

Get-ChildItem -Path . -Recurse -Include *.html,*.md,*.js | ForEach-Object {
  $file = $_.FullName
  $text = Get-Content $file -Raw
  $newText = $text
  foreach ($pattern in $patterns) {
    $newText = [regex]::Replace($newText, $pattern, {
      param($m)
      $m.Value -replace '\d+\.\d+\.\d+', $Version
    })
  }
  if ($newText -ne $text) {
    Set-Content -Path $file -Value $newText
  }
}

# Update CHANGELOG
& "$PSScriptRoot\changelog.ps1" -Version $Version