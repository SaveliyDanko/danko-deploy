// Сборка сервера в один self-contained dist/main.js через esbuild.
//
// Зачем: в проде раньше сервер запускался через tsx (транспиляция TS в рантайме →
// резидентный esbuild-сервис + кеш модулей в памяти, ~100–250 МБ впустую). Бандл
// исполняется чистым `node dist/main.js` — транспилятор в памяти не живёт.
//
// Что бандлим: ТОЛЬКО наш TypeScript — apps/server + workspace-пакеты @dankodeploy/*
// (они резолвятся на исходники src/*.ts, поэтому без бандла node их не исполнит).
// Все npm-пакеты и node:builtin остаются EXTERNAL и грузятся из node_modules как есть.
//
// Почему не бандлим npm: часть пакетов завязана на рантайм-окружение CJS
// (node-cron спавнит daemon.js по `__dirname`, better-sqlite3/ssh2 — нативные .node).
// Бандлить их в ESM → ломается `__dirname`/раскладка файлов. External этого избегает.
//
// Контракт: все npm-пакеты, которые workspace-код импортирует НАПРЯМУЮ
// (better-sqlite3, drizzle-orm, node-ssh, ssh2, zod), объявлены в зависимостях
// @dankodeploy/server — иначе node не найдёт их при резолве из apps/server/.
//
// Нюанс проекта: относительные импорты пишутся с расширением `.js` даже для `.ts`
// (NodeNext) — плагин js→ts переводит их в реальные `.ts` при резолве.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));

/** Все bare-импорты (npm + node:builtin) — external, КРОМЕ workspace @dankodeploy/*. */
const externalizeNpm = {
  name: "externalize-npm",
  setup(b) {
    // Спецификатор без ведущих "." и "/" → bare-импорт.
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@dankodeploy/") ? undefined : { path: args.path, external: true },
    );
  },
};

/** Относительный импорт `./foo.js`, которому на диске соответствует `foo.ts`. */
const jsToTs = {
  name: "js-to-ts",
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === "entry-point" || !args.path.startsWith(".")) return undefined;
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
      return existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

await build({
  entryPoints: [resolve(here, "src/main.ts")],
  outfile: resolve(here, "dist/main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  plugins: [externalizeNpm, jsToTs],
});
