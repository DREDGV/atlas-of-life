#!/usr/bin/env node

/**
 * Скрипт для автоматического обновления версии в проекте
 * Использование: node update-version.js "v0.6.1-new-feature"
 */

const fs = require('fs');
const path = require('path');

// Получаем новую версию из аргументов командной строки
const newVersion = process.argv[2];
if (!newVersion) {
  console.error('❌ Ошибка: Укажите версию');
  console.log('Использование: node update-version.js "v0.6.1-new-feature"');
  process.exit(1);
}

console.log(`🔄 Обновляем версию до: ${newVersion}`);

// Функция для обновления версии в файле
function updateVersionInFile(filePath, patterns) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let updated = false;
    
    patterns.forEach(pattern => {
      const regex = new RegExp(pattern.search, 'g');
      if (regex.test(content)) {
        content = content.replace(regex, pattern.replace);
        updated = true;
      }
    });
    
    if (updated) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Обновлен: ${filePath}`);
    } else {
      console.log(`⚠️  Не найдено совпадений в: ${filePath}`);
    }
  } catch (error) {
    console.error(`❌ Ошибка при обновлении ${filePath}:`, error.message);
  }
}

// Паттерны для обновления версии
const versionPatterns = [
  {
    file: 'index.html',
    patterns: [
      {
        search: '<title>Атлас жизни v[^<]+</title>',
        replace: `<title>Атлас жизни ${newVersion}</title>`
      },
      {
        search: 'src="./js/app.js\\?v=[^"]+',
        replace: `src="./js/app.js?v=${newVersion}&t=${Date.now()}&cache=bust&force=${Math.floor(Math.random() * 100)}`
      }
    ]
  },
  {
    file: 'js/app.js',
    patterns: [
      {
        search: 'let APP_VERSION = "[^"]+";',
        replace: `let APP_VERSION = "Atlas_of_life_${newVersion}";`
      }
    ]
  }
];

// Обновляем версии во всех файлах
versionPatterns.forEach(({ file, patterns }) => {
  updateVersionInFile(file, patterns);
});

console.log(`🎉 Версия ${newVersion} успешно обновлена!`);
console.log('📝 Не забудьте обновить CHANGELOG.md и REQUESTS.md');
