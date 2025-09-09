# Добавляет строки подключений аддонов в index.html, если их ещё нет
$index = "index.html"
$block = @'
<link rel="stylesheet" href="addons/fix-ui.css">
<script src="addons/fixes-v0.2.6.js"></script>
'@

if (-not (Test-Path $index)) {
  Write-Host "❌ Не найден $index"
  exit 1
}

$content = Get-Content $index -Raw -Encoding UTF8

if ($content -notmatch 'addons/fixes-v0\.2\.6\.js') {
  # Вставим перед закрывающим </body>
  $content = $content -replace '</body>', ($block + "`r`n</body>")
  Set-Content $index $content -NoNewline -Encoding UTF8
  Write-Host "✅ Подключены addons/fix-ui.css и addons/fixes-v0.2.6.js"
} else {
  Write-Host "ℹ️ Уже подключено — ничего не меняю."
}
