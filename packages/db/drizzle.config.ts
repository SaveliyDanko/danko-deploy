import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Подхватываем корневой .env, чтобы drizzle-kit (push/generate/studio) работал
// с тем же DATABASE_URL, что и сервер. drizzle-kit запускается из packages/db,
// поэтому корень репо — на два уровня выше cwd. Node 20.6+ даёт process.loadEnvFile.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(rootEnv);
}

const dbUrl = process.env.DATABASE_URL ?? "./data/dankodeploy.sqlite";

// drizzle-kit не создаёт каталог под файл БД сам — создаём заранее (как createDb).
const dbFile = isAbsolute(dbUrl) ? dbUrl : resolve(process.cwd(), dbUrl);
mkdirSync(dirname(dbFile), { recursive: true });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: { url: dbUrl },
});
