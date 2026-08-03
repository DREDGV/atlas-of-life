<#
  Read-only baseline verification for Atlas of Life.
  Run: powershell -ExecutionPolicy Bypass -File tools/verify-baseline.ps1
#>

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$issues = [System.Collections.Generic.List[string]]::new()

function Test-RequiredFile([string]$relativePath) {
  $path = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $issues.Add("Missing required file: $relativePath")
  }
}

@(
  'index.html',
  'styles.css',
  'js/app.js',
  'js/state.js',
  'js/storage.js',
  'js/view_map.js',
  'js/view_today.js',
  'js/inspector.js'
) | ForEach-Object { Test-RequiredFile $_ }

$indexPath = Join-Path $projectRoot 'index.html'
if (Test-Path -LiteralPath $indexPath) {
  $indexHtml = Get-Content -LiteralPath $indexPath -Raw
  [regex]::Matches($indexHtml, '(?:src|href)="([^"]+)"') | ForEach-Object {
    $reference = $_.Groups[1].Value
    if ($reference -match '^(https?:|data:|#)') { return }
    $relativePath = ($reference -split '[?#]')[0]
    if ([string]::IsNullOrWhiteSpace($relativePath)) { return }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
      $issues.Add("Missing asset referenced by index.html: $reference")
    }
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $issues.Add('Node.js is required for JavaScript syntax verification.')
} else {
  Get-ChildItem -Path (Join-Path $projectRoot 'js'), (Join-Path $projectRoot 'addons') -Recurse -Filter '*.js' |
    Where-Object { $_.Name -notmatch '\.(backup|fixed)\.js$' } |
    ForEach-Object {
      & node --check $_.FullName 2>$null
      if ($LASTEXITCODE -ne 0) {
        $issues.Add("JavaScript syntax error: $($_.FullName)")
      }
    }

  Get-ChildItem -Path (Join-Path $projectRoot 'tests') -Filter '*.mjs' | ForEach-Object {
    & node --no-warnings $_.FullName 2>$null
    if ($LASTEXITCODE -ne 0) {
      $issues.Add("Regression test failed: $($_.Name)")
    }
  }
}

if ($issues.Count -gt 0) {
  $issues | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Host 'Baseline verification passed: required assets and JavaScript syntax are valid.' -ForegroundColor Green
