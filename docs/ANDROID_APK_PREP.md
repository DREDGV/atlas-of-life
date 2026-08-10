# Atlas Capture: подготовка Android APK

Состояние: подготовительный этап для `0.9.0-alpha.2`.

## Цель этапа

Получить воспроизводимую debug-сборку Atlas Capture для установки на физический Android-телефон. В APK входят мобильный захват текста, локальный Inbox и автономное хранение.

## Технология

- Capacitor 8.5.0
- Node.js 22+
- Android Studio 2025.2.1+ с Android SDK
- Application ID: `com.dredgv.atlas.capture`
- Минимальная версия Android определяется шаблоном Capacitor 8 (API 24+)

Application ID считается рабочим до первой публичной публикации. После выпуска в Google Play менять его нельзя без создания нового приложения.

## Первая локальная подготовка

```bash
npm ci
npm run test:android-prep
npm run android:add
npm run android:open
```

Команда `android:add` создаёт каталог `android/`. Затем проект открывается в Android Studio.

## Последующие обновления веб-кода

```bash
npm run android:sync
```

Эта команда заново формирует `dist/android` и переносит актуальные ресурсы Atlas Capture в Android-проект.

## Где появляется APK

После `assembleDebug`:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions также собирает этот файл и публикует его как артефакт `atlas-capture-debug-apk` сроком на 14 дней.

## Что намеренно отложено

- нативный Android Share Intent;
- нативное распознавание речи и разрешение микрофона;
- синхронизация с компьютером;
- release-подпись и Google Play AAB;
- перенос всего настольного интерфейса Atlas Studio.

Первый контрольный тест APK: установка, запуск, сохранение текста, перезапуск приложения и проверка, что запись осталась во «Входящих».
