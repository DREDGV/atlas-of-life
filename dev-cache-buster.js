// Development Cache Buster
// Запускать этот скрипт для обновления версий в index.html

const fs = require('fs');
const path = require('path');

function updateCacheVersions() {
  const indexPath = path.join(__dirname, 'index.html');
  let content = fs.readFileSync(indexPath, 'utf8');
  
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substr(2, 9);
  
  // Обновляем версии CSS
  content = content.replace(
    /styles\.css\?v=[^"]*/g,
    `styles.css?v=dev-${timestamp}-${randomId}`
  );
  
  // Обновляем версии JS
  content = content.replace(
    /js\/app\.js\?v=[^"]*/g,
    `js/app.js?v=dev-${timestamp}-${randomId}`
  );
  
  // Обновляем заголовок
  content = content.replace(
    /<title>Атлас жизни v[^<]*<\/title>/g,
    `<title>Атлас жизни v0.6.8.6-inbox-batch-ops-dev-${timestamp}</title>`
  );
  
  fs.writeFileSync(indexPath, content);
  console.log(`✅ Cache versions updated with timestamp: ${timestamp}`);
  console.log(`🔄 Random ID: ${randomId}`);
  console.log(`📝 Updated: ${indexPath}`);
}

if (require.main === module) {
  updateCacheVersions();
}

module.exports = { updateCacheVersions };
