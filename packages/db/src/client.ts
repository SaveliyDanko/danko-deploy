import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;
/** Низкоуровневый дескриптор better-sqlite3 (для raw-операций, напр. бэкап конфигурации). */
export type SqliteDb = Database.Database;

export interface DbHandle {
  db: Db;
  sqlite: SqliteDb;
}

/**
 * Создаёт подключение к SQLite-файлу и Drizzle-обёртку.
 * Каталог под файл БД создаётся автоматически. Включаем WAL и FK.
 */
export function createDb(databaseUrl: string): DbHandle {
  const filePath = isAbsolute(databaseUrl) ? databaseUrl : resolve(process.cwd(), databaseUrl);
  mkdirSync(dirname(filePath), { recursive: true });

  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
