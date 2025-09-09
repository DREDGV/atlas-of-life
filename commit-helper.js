// commit-helper.js - Автоматический генератор сообщений коммитов
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const commitTypes = {
  feat: 'Новая функция',
  fix: 'Исправление ошибки',
  docs: 'Обновление документации',
  style: 'Изменения стиля (форматирование, пропуски)',
  refactor: 'Рефакторинг кода',
  perf: 'Улучшение производительности',
  test: 'Добавление/исправление тестов',
  chore: 'Общие изменения (сборка, зависимости)',
  build: 'Изменения в системе сборки',
  ci: 'Изменения в CI/CD',
  revert: 'Откат предыдущих изменений'
};

function getChangedFiles() {
  try {
    const stdout = execSync('git diff --name-only --cached', { encoding: 'utf8' });
    return stdout.trim().split('\n').filter(Boolean);
  } catch (error) {
    console.error('Ошибка при получении измененных файлов:', error.message);
    return [];
  }
}

function prompt(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function generateCommitMessage() {
  console.log('\n--- 🚀 Генератор сообщения коммита ---');
  console.log('Выберите тип коммита:');
  const typesArray = Object.entries(commitTypes);
  typesArray.forEach(([key, desc], index) => {
    console.log(`${index + 1}. ${key}: ${desc}`);
  });

  let typeKey;
  while (true) {
    const answer = await prompt(`\nВведите номер типа (1-${typesArray.length}) или "${typesArray[0][0]}" для "${typesArray[0][0]}": `);
    if (Object.keys(commitTypes).includes(answer.toLowerCase())) {
      typeKey = answer.toLowerCase();
      break;
    }
    const typeIndex = parseInt(answer, 10) - 1;
    if (typeIndex >= 0 && typeIndex < typesArray.length) {
      typeKey = typesArray[typeIndex][0];
      break;
    }
    console.log('❌ Неверный ввод. Попробуйте еще раз.');
  }

  const scope = await prompt('Введите область изменений (например, "sidebar", "map", "auth", или оставьте пустым): ');
  const subject = await prompt('Введите краткое описание изменений (обязательно): ');

  if (!subject.trim()) {
    console.error('❌ Описание не может быть пустым. Отмена коммита.');
    rl.close();
    return;
  }

  let commitMessage = `${typeKey}`;
  if (scope.trim()) {
    commitMessage += `(${scope.trim()})`;
  }
  commitMessage += `: ${subject.trim()}`;

  const changedFiles = getChangedFiles();
  if (changedFiles.length > 0) {
    console.log('\n📁 Измененные файлы:');
    changedFiles.forEach(file => console.log(`- ${file}`));
    const addFilesToBody = await prompt('Добавить список измененных файлов в тело коммита? (да/нет, по умолчанию нет): ');
    if (addFilesToBody.toLowerCase() === 'да') {
      commitMessage += '\n\nИзмененные файлы:\n' + changedFiles.map(file => `- ${file}`).join('\n');
    }
  }

  const body = await prompt('Введите дополнительное описание (тело коммита, оставьте пустым для пропуска): ');
  if (body.trim()) {
    commitMessage += `\n\n${body.trim()}`;
  }

  console.log('\n--- 📝 Сгенерированное сообщение коммита ---');
  console.log(commitMessage);

  const confirm = await prompt('\n✅ Применить этот коммит? (да/нет): ');
  if (confirm.toLowerCase() === 'да') {
    try {
      execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
      console.log('\n🎉 Коммит успешно создан!');
    } catch (error) {
      console.error('\n❌ Ошибка при создании коммита:', error.message);
    }
  } else {
    console.log('❌ Коммит отменен.');
  }

  rl.close();
}

generateCommitMessage();
