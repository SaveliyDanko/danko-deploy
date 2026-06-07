import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createDb } from "./client.js";

/** Применяет сгенерированные drizzle-kit миграции к БД. Запускается через `pnpm db:migrate`. */
function run() {
  const databaseUrl = process.env.DATABASE_URL ?? "./data/dankodeploy.sqlite";
  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

  const { db, sqlite } = createDb(databaseUrl);
  migrate(db, { migrationsFolder });
  sqlite.close();
  console.log(`Migrations applied to ${databaseUrl}`);
}

run();
