import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { buildContext } from "./context.js";

async function main() {
  const config = loadConfig();
  const ctx = buildContext(config);
  const app = await buildApp(ctx);

  // Помечаем «зависшие» running-запуски прошлого процесса как failed (их onDone
  // уже не выполнится после рестарта) — чтобы история не копила вечные running.
  ctx.deploys.reconcileOrphans();

  // Запускаем фоновые сервисы
  ctx.scheduler.reload();
  ctx.metrics.start();

  const shutdown = async (signal: string) => {
    app.log.info(`Получен ${signal}, завершаюсь...`);
    await app.close();
    ctx.dispose();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`DankoDeploy server на http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error("Не удалось запустить сервер:", err);
  process.exit(1);
});
