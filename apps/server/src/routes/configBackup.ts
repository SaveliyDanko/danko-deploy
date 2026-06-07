import { exportConfigSchema, importModeSchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";

export function registerConfigBackupRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Экспорт всей конфигурации в ZIP (config.json + опц. файлы бэкапов).
  // Секреты перешифрованы под пароль экспорта. Отдаём как файл (attachment).
  app.post("/api/config/export", (req, reply) => {
    const parsed = exportConfigSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { zip, filename } = ctx.configBackup.export(
      parsed.data.password,
      parsed.data.includeBackupFiles,
    );
    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(zip);
  });

  // Импорт конфигурации: файл бэкапа (zip или legacy json) + пароль и режим как
  // поля формы (multipart). Проверяет пароль, перешифровывает под master-key, upsert по id.
  app.post("/api/config/import", async (req, reply) => {
    const parts = req.parts();
    let password = "";
    let mode = "merge";
    let fileBuffer: Buffer | undefined;

    try {
      for await (const part of parts) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
        } else if (part.fieldname === "password") {
          password = String(part.value);
        } else if (part.fieldname === "mode") {
          mode = String(part.value);
        }
      }
    } catch (err) {
      return reply.status(400).send({
        error: `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.status(400).send({ error: "Файл бэкапа не передан" });
    }
    if (!password) return reply.status(400).send({ error: "Укажите пароль бэкапа" });
    const parsedMode = importModeSchema.safeParse(mode);
    if (!parsedMode.success) return reply.status(400).send({ error: "Неверный режим импорта" });

    try {
      const result = ctx.configBackup.import(password, fileBuffer, parsedMode.data);
      ctx.scheduler.reload(); // могли измениться проекты/деплои с backupCron
      return result;
    } catch (err) {
      // Неверный пароль / повреждённый файл — 400 с понятным текстом.
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
