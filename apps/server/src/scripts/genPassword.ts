import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { hashPassword } from "@dankodeploy/core";

/**
 * Генерирует scrypt-хэш пароля для аутентификации панели.
 * Пароль можно передать аргументом или ввести интерактивно (без эха в консоли).
 * Выводит готовую строку DANKODEPLOY_AUTH_PASSWORD_HASH=... для вставки в .env.
 */
async function main() {
  let password = process.argv[2];

  if (!password) {
    const rl = createInterface({ input: stdin, output: stdout });
    password = await rl.question("Введите пароль для панели: ");
    rl.close();
  }

  if (!password || password.length < 4) {
    console.error("Пароль слишком короткий (минимум 4 символа).");
    process.exit(1);
  }

  const hash = hashPassword(password);
  console.log("\nДобавьте эти строки в .env:\n");
  console.log(`DANKODEPLOY_AUTH_PASSWORD_HASH=${hash}`);
  console.log(`DANKODEPLOY_SESSION_SECRET=${randomSecret()}`);
}

/** Случайный секрет для подписи cookie сессии. */
function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
