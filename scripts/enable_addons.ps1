# scripts/enable_addons.ps1
$index = "index.html"
$block = @'
<link rel="stylesheet" href="addons/addons.css">
<script src="addons/ics-export.js"></script>
<script src="addons/autocomplete.js"></script>
<script src="addons/today-plus.js"></script>
<script src="addons/inspector-plus.js"></script>
'@
$content = Get-Content $index -Raw -Encoding UTF8
if ($content -notmatch 'addons/autocomplete.js') {
    $content = $content -replace '</body>', ($block + "`r`n</body>")
    Set-Content $index $content -NoNewline -Encoding UTF8
    Write-Host "✅ Addons подключены."
}
else {
    Write-Host "ℹ️ Уже подключено — ничего не меняю."
}
