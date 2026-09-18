// tools/serve-atlas.mjs — поднять Atlas локально для ручной работы в браузере.
//
// Это тот же статический сервер, которым пользуются смоуки (tools/smoke-shared.mjs),
// вынесенный в отдельную команду: приложение Atlas Studio — статические файлы,
// никакой сборки, поэтому «запустить атлас» = отдать каталог репозитория по HTTP
// на loopback. Порт по умолчанию 4173, меняется через ATLAS_PORT.
//
//   node tools/serve-atlas.mjs
//   ATLAS_PORT=4300 node tools/serve-atlas.mjs
import { startStaticServer, closeAll } from './smoke-shared.mjs';

const port = Number.parseInt(process.env.ATLAS_PORT || '4173', 10);
const { server, origin } = await startStaticServer({ port });

console.log(`Atlas Studio: ${origin}`);
console.log('  /            — Studio (карта, Inspector, Today, материалы)');
console.log('  /capture/    — Atlas Capture (телефонный захват)');
console.log('Ctrl+C — остановить.');

const shutdown = async () => {
  await closeAll({ server });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
