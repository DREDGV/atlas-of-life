# Skill: atlas-development

Практический workflow для любой обычной задачи разработки Atlas of Life.

## Алгоритм

1. Прочитать `AGENTS.md`.
2. Прочитать актуальную `docs/ROADMAP_REVIVAL.md`.
3. Определить branch / PR / HEAD.
4. Проверить `git status --short`, `git status -sb`, `git log -1 --oneline`.
5. Не трогать unrelated/untracked файлы; без `git clean -fd`, `git reset --hard`, `git add .`.
6. Изучить фактический код нужной области (код и roadmap имеют приоритет над устаревшими описаниями).
7. Сформулировать небольшой implementation plan.
8. Реализовать законченный продуктовый кусок.
9. Не расширять scope без причины.
10. Выполнить focused tests (`node tests/*.mjs` для нужных файлов).
11. Запустить `tools/verify-baseline.ps1`, если это принято на текущем этапе.
12. Commit только относящихся к задаче путей (conventional commit).
13. Push.
14. Проверить новый HEAD (`git rev-parse HEAD`).
15. Отчитаться и остановиться.

## Правила

- Persisted changes — только через Core commands; UI drafts остаются ephemeral.
- Если обнаружен unrelated blocker — описать его, но не начинать самовольную масштабную переделку.
- Не менять версию за мелкий fix; версия появляется только с новым product milestone.
- Не merge PR без явной команды пользователя.
- В отчёте: branch, HEAD, изменённые области, проверки, CI, ограничения.

## Типичный промт

> Прочитай AGENTS.md и используй skill atlas-development. Продолжай текущий PR и исправь … Commit + push + HEAD и остановись.