param(
  [Parameter(Mandatory=$true)][ValidateSet('user','assistant')]
  [string]$Role,
  [Parameter(Mandatory=$true)]
  [string]$Content,
  [string]$Session
)

if (-not $Session -or $Session.Trim() -eq '') {
  $Session = (Get-Date -Format "yyyyMMdd")
}

$dir = Join-Path -Path "." -ChildPath ".codex"
if (-not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$path = Join-Path -Path $dir -ChildPath "chat-history.jsonl"

$entry = [PSCustomObject]@{
  timestamp = (Get-Date).ToString("o")
  role      = $Role
  session   = $Session
  content   = $Content
}

$json = $entry | ConvertTo-Json -Compress
Add-Content -Path $path -Value $json

