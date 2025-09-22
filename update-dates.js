const fs = require('fs');
const path = require('path');

// Получить текущую дату в разных форматах
const today = new Date();
const dateDDMMYYYY = today.toLocaleDateString('ru-RU'); // 22.09.2025
const dateYYYYMMDD = today.toISOString().split('T')[0]; // 2025-09-22
const dateRussian = today.toLocaleDateString('ru-RU', { 
  day: 'numeric', 
  month: 'long', 
  year: 'numeric' 
}); // 22 сентября 2025

console.log(`🔄 Обновляем даты на: ${dateRussian}`);
console.log(`📅 DD.MM.YYYY: ${dateDDMMYYYY}`);
console.log(`📅 YYYY-MM-DD: ${dateYYYYMMDD}`);

// Функция для обновления файла
function updateFile(filePath, updates) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ Файл не найден: ${filePath}`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  updates.forEach(update => {
    const originalContent = content;
    content = content.replace(update.regex, update.replacement);
    if (content !== originalContent) {
      changed = true;
      console.log(`✅ Обновлен: ${path.basename(filePath)} - ${update.description}`);
    }
  });

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

// Обновления для каждого файла
const updates = [
  {
    file: 'CURRENT_STATUS.md',
    updates: [
      {
        regex: /(# Текущий статус \()\d{2}\.\d{2}\.\d{4}(\))/,
        replacement: `$1${dateDDMMYYYY}$2`,
        description: 'дата статуса'
      }
    ]
  },
  {
    file: 'CHANGELOG.md',
    updates: [
      {
        regex: /(## Atlas_of_life_v\d+\.\d+\.\d+\.\d+-[^ ]+ \()\d{2}\.\d{2}\.\d{4}(\))/,
        replacement: `$1${dateDDMMYYYY}$2`,
        description: 'дата версии в changelog'
      }
    ]
  },
  {
    file: 'REQUESTS.md',
    updates: [
      {
        regex: /(### )\d{4}-\d{2}-\d{2}( — [^<]+)/,
        replacement: `$1${dateYYYYMMDD}$2`,
        description: 'дата запроса'
      }
    ]
  },
  {
    file: 'USER_MANUAL.md',
    updates: [
      {
        regex: /(\*\*Дата:\*\* )\d{1,2} [а-я]+ \d{4}/,
        replacement: `$1${dateRussian}`,
        description: 'дата в руководстве'
      }
    ]
  }
];

// Применить все обновления
let totalUpdated = 0;
updates.forEach(fileUpdate => {
  if (updateFile(fileUpdate.file, fileUpdate.updates)) {
    totalUpdated++;
  }
});

console.log(`\n🎯 Обновлено файлов: ${totalUpdated}`);
console.log(`📅 Все даты установлены на: ${dateRussian}`);
console.log(`✅ Готово! Теперь можно коммитить изменения.`);
