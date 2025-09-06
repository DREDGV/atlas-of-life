# Инструменты Atlas

Здесь находятся скрипты и подсказки, которые помогают обслуживать и развивать проект Atlas of life. Они автоматизируют рутину и дают опору для более крупных изменений.

## changelog.ps1 / changelog.sh

Скрипты для обновления `CHANGELOG.md`. Переносят блок **[Unreleased]** под заголовок новой версии и проставляют текущую дату. PowerShell‑вариант умеет дополнительно ставить git‑тег.

### Примеры

Windows / PowerShell:

```powershell
pwsh -File tools/changelog.ps1 -Version 0.2.6
# Одновременно поставить тег:
pwsh -File tools/changelog.ps1 -Version 0.2.6 -Tag
```

Unix‑подобные системы:

```bash
bash tools/changelog.sh 0.2.6
```

## bump.ps1

Ищет в проекте строковые версии вида `Atlas of life - vX.Y.Z` и `Atlas_of_life_vX.Y.Z` и заменяет на новое значение. Параллельно обновляет changelog, вызывая `changelog.ps1`.

Пример:

```powershell
pwsh -File tools/bump.ps1 -Version 0.2.6
```

## githooks/commit-msg

Хук проверки сообщений коммитов на соответствие стандарту [Conventional Commits](https://www.conventionalcommits.org/). Чтобы использовать, либо скопируйте файл в `.git/hooks/commit-msg`, либо укажите общий путь хуков (см. ниже). Несоответствующие сообщения будут отклоняться.

## append-changelog.ps1 + githooks/post-commit

Автоматически добавляет тему последнего коммита в `CHANGELOG.md` в секцию `## [Unreleased]`.

Настройка:

- Указать Git путь к папке хуков из репозитория:

  ```bash
  git config core.hooksPath tools/githooks
  ```

- Убедиться, что установлен PowerShell 7+ (`pwsh`) и он доступен в PATH.

Как работает:

- После каждого коммита хук запускает `tools/append-changelog.ps1`, который вставляет строку вида `- feat: add X (abc123)` сразу под `## [Unreleased]`. История не затирается; дубликаты по хэшу коммита игнорируются.

## bump-version.ps1 (помощник релиза)

Создаёт наверху секцию вида `## Atlas_of_life_vX.Y.Z - YYYY-MM-DD HH:mm`. Если в `## [Unreleased]` есть записи, они переносятся под новую секцию и «очищают» `Unreleased`. Также обновляется резервное значение `APP_VERSION` в `js/app.js`.

Примеры:

```powershell
pwsh -File tools/bump-version.ps1 -Part patch      # 0.2.6 -> 0.2.7
pwsh -File tools/bump-version.ps1 -Version 0.2.8   # точная версия
pwsh -File tools/bump-version.ps1 -Part minor -Tag  # бамп + git tag vX.Y.Z
```

## prompts

Папка `prompts` содержит инструкции для инструментов автогенерации кода (GitHub Copilot, ассистент в VS Code и т.п.).

- `reorg-minimal.txt` — минимальная реорганизация: миграции, адаптеры хранилища, тема, аналитика, фасад состояния без переразмещения файлов. Полезно при подготовке релиза 0.2.6.
- `reorg-full.txt` — полноценная перестройка на модульную архитектуру с новой структурой и потенциальными breaking‑changes. Для планирования 0.3.0.

Подсказки примерные — адаптируйте под свой процесс. Их цель — сформулировать чёткие задачи для инструментов рефакторинга.

