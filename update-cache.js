// Скрипт для автоматического обновления timestamp в index.html
const fs = require('fs');
const path = require('path');

function updateTimestamp() {
  const indexPath = path.join(__dirname, 'index.html');
  const timestamp = Date.now();
  
  try {
    let content = fs.readFileSync(indexPath, 'utf8');
    
    // Обновляем timestamp в CSS ссылке
    content = content.replace(
      /styles\.css\?v=[^&]*&t=\d+/g,
      `styles.css?v=0.2.7.6&t=${timestamp}`
    );
    
    // Обновляем timestamp в JS ссылке
    content = content.replace(
      /app\.js\?v=[^&]*&t=\d+/g,
      `app.js?v=0.2.7.6&t=${timestamp}`
    );
    
    fs.writeFileSync(indexPath, content, 'utf8');
    console.log(`✅ Timestamp обновлен: ${timestamp}`);
  } catch (error) {
    console.error('❌ Ошибка обновления timestamp:', error);
  }
}

updateTimestamp();
