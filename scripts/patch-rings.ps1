# scripts/patch-rings.ps1
$ErrorActionPreference = "Stop"

# 1) Путь к целевому файлу
$path = "js/view_map.js"
if (-not (Test-Path $path)) {
    Write-Host "❌ Не найден $path. Запускайте скрипт из корня проекта (там, где index.html и папка js/)."
    exit 1
}

# 2) Читаем исходник
$content = Get-Content $path -Raw -Encoding UTF8

# 3) Регулярка, которая ловит ВЕСЬ опасный блок:
#    if (placed < siblings.length) {
#      rings[rings.length - 1].tasks = rings[rings.length - 1].tasks.concat(siblings.slice(placed));
#    }
$pattern = @'
if\s*\(\s*placed\s*<\s*siblings\.length\s*\)\s*\{
\s*rings\s*\[\s*rings\.length\s*-\s*1\s*\]\.tasks\s*=\s*rings\s*\[\s*rings\.length\s*-\s*1\s*\]\.tasks\s*\.concat\s*\(\s*siblings\.slice\s*\(\s*placed\s*\)\s*\)\s*;
\s*\}
'@

# 4) Безопасная замена (создаём "последнее кольцо", если его нет)
$replacement = @'
if (placed < siblings.length) {
  if (rings.length === 0) {
    rings.push({ radius: currentRadius, tasks: [] });
  }
  const last = rings[rings.length - 1];
  last.tasks = last.tasks.concat(siblings.slice(placed));
}
'@

# 5) Применяем
if ($content -match $pattern) {
    # Бэкап на всякий случай
    Copy-Item $path "$path.bak" -Force

    $new = [regex]::Replace(
        $content,
        $pattern,
        $replacement,
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    if ($new -ne $content) {
        Set-Content $path $new -NoNewline -Encoding UTF8
        Write-Host "✅ Патч применён: добавлена страховка для 'последнего кольца'."
        Write-Host "📝 Резервная копия: $path.bak"
        exit 0
    }
    else {
        Write-Host "ℹ️ Шаблон найден, но содержимое не изменилось — возможно, патч уже применён ранее."
        exit 0
    }
}
else {
    Write-Host "⚠️ Опасный блок не найден. Вероятно, код отличается по формату."
    Write-Host "👉 Поиск по строке:  rings[rings.length - 1].tasks = rings[rings.length - 1].tasks.concat(siblings.slice(placed));"
    exit 2
}
