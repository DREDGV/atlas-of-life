# PowerShell скрипт для обновления timestamp в index.html
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$indexPath = "index.html"

if (Test-Path $indexPath) {
    $content = Get-Content $indexPath -Raw -Encoding UTF8
    
    # Обновляем timestamp в CSS ссылке
    $content = $content -replace 'styles\.css\?v=[^&]*&t=\d+', "styles.css?v=0.2.7.6&t=$timestamp"
    
    # Обновляем timestamp в JS ссылке  
    $content = $content -replace 'app\.js\?v=[^&]*&t=\d+', "app.js?v=0.2.7.6&t=$timestamp"
    
    Set-Content $indexPath -Value $content -Encoding UTF8
    Write-Host "✅ Timestamp обновлен: $timestamp" -ForegroundColor Green
} else {
    Write-Host "❌ Файл index.html не найден" -ForegroundColor Red
}
