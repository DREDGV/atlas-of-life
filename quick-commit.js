// quick-commit.js - Быстрый коммит с предустановленными сообщениями
const { execSync } = require('child_process');

const quickMessages = {
  '1': 'feat: новая функция',
  '2': 'fix: исправление ошибки',
  '3': 'docs: обновление документации',
  '4': 'style: изменения стиля',
  '5': 'refactor: рефакторинг кода',
  '6': 'perf: улучшение производительности',
  '7': 'chore: общие изменения',
  '8': 'build: изменения в системе сборки'
};

function getChangedFiles() {
  try {
    const stdout = execSync('git diff --name-only --cached', { encoding: 'utf8' });
    return stdout.trim().split('\n').filter(Boolean);
  } catch (error) {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('🚀 Быстрый коммит - выберите тип:');
    Object.entries(quickMessages).forEach(([key, msg]) => {
      console.log(`${key}. ${msg}`);
    });
    console.log('\nИспользование: node quick-commit.js [номер] [дополнительное описание]');
    console.log('Пример: node quick-commit.js 1 "добавлен поиск в панели"');
    return;
  }

  const type = args[0];
  const additional = args.slice(1).join(' ');
  
  if (!quickMessages[type]) {
    console.error('❌ Неверный номер типа. Доступные: 1-8');
    return;
  }

  let message = quickMessages[type];
  if (additional) {
    message += ` - ${additional}`;
  }

  const changedFiles = getChangedFiles();
  if (changedFiles.length === 0) {
    console.log('❌ Нет изменений для коммита. Сначала выполните: git add .');
    return;
  }

  console.log(`📝 Сообщение коммита: ${message}`);
  console.log(`📁 Измененные файлы: ${changedFiles.length}`);
  
  try {
    execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
    console.log('✅ Коммит успешно создан!');
  } catch (error) {
    console.error('❌ Ошибка при создании коммита:', error.message);
  }
}

main();
