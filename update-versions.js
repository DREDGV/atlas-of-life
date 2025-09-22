// Простой скрипт для обновления версий в index.html
// Использование: node update-versions.js

const fs = require('fs');

// Читаем index.html
let content = fs.readFileSync('index.html', 'utf8');

// Генерируем новый timestamp
const timestamp = Date.now();
const random = Math.random().toString(36).substr(2, 6);

console.log(`🔄 Обновляем версии с timestamp: ${timestamp}`);
console.log(`🎲 Random ID: ${random}`);

// Обновляем CSS версии
content = content.replace(
  /styles\.css\?v=[^"]*/g,
  `styles.css?v=dev-${timestamp}-${random}`
);

// Обновляем JS версии  
content = content.replace(
  /js\/app\.js\?v=[^"]*/g,
  `js/app.js?v=dev-${timestamp}-${random}`
);

// Обновляем заголовок
content = content.replace(
  /<title>Атлас жизни v[^<]*<\/title>/g,
  `<title>Атлас жизни v0.6.8.6-inbox-batch-ops-dev-${timestamp}</title>`
);

// Записываем обратно
fs.writeFileSync('index.html', content);

console.log('✅ Версии обновлены! Теперь можно обновить страницу.');
console.log('💡 Используйте Ctrl+F5 для принудительного обновления.');
