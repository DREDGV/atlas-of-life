param(
  [string[]]$IncludeExtensions = @('*.js','*.ts','*.tsx','*.jsx','*.html','*.htm','*.css','*.scss','*.less','*.json','*.md','*.txt','*.yml','*.yaml','*.ini','*.toml','*.cfg','*.vue','*.svelte'),
  [switch]$Fix,
  [switch]$WithBom
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$utf8Strict = [System.Text.UTF8Encoding]::new($false, $true) # throwOnInvalid
$encUtf8NoBom = [System.Text.UTF8Encoding]::new($false)
$encUtf8WithBom = [System.Text.UTF8Encoding]::new($true)
$encCp1251 = [System.Text.Encoding]::GetEncoding(1251)

function Test-Utf8Strict([byte[]]$bytes){
  try { [void]$utf8Strict.GetString($bytes); return $true } catch { return $false }
}

function Get-TextFiles([string[]]$patterns){
  Get-ChildItem -Recurse -File -Include $patterns | Sort-Object FullName
}

$files = Get-TextFiles -patterns $IncludeExtensions
if(-not $files){ Write-Host 'No files matched.'; exit 0 }

$bad = @()
foreach($f in $files){
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  if(-not (Test-Utf8Strict $bytes)){
    $bad += $f
  }
}

if($bad.Count -eq 0){
  Write-Host 'All matched files are valid UTF-8.' -ForegroundColor Green
  exit 0
}

Write-Host "Not valid UTF-8 (strict):" -ForegroundColor Yellow
$bad | ForEach-Object { Write-Host " - $($_.FullName)" }

if($Fix){
  Write-Host "\nFixing by converting from Windows-1251 -> UTF-8$([bool]$WithBom ? ' (with BOM)' : ' (no BOM)')" -ForegroundColor Cyan
  $encOut = if($WithBom){ $encUtf8WithBom } else { $encUtf8NoBom }
  foreach($f in $bad){
    $orig = [System.IO.File]::ReadAllBytes($f.FullName)
    $textCp = $encCp1251.GetString($orig)
    # normalize line endings to LF
    $textCp = $textCp -replace "`r?`n","`n"
    $bytesOut = $encOut.GetBytes($textCp)
    $bak = "$($f.FullName).bak"
    if(-not (Test-Path $bak)) { Copy-Item -Path $f.FullName -Destination $bak }
    [System.IO.File]::WriteAllBytes($f.FullName, $bytesOut)
    Write-Host "Converted: $($f.FullName)"
  }
}

