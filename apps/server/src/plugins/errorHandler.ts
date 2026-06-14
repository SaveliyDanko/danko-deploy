import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Глобальный обработчик ошибок и 404. Гарантирует единый формат ответа `{ error }`
 * и — главное — НЕ отдаёт наружу стектрейсы/внутренности при 5xx (утечка структуры
 * кода и данных). Все необработанные исключения логируются на сервере, клиент же
 * получает безопасный общий текст. Клиентские ошибки (4xx) и их сообщения сохраняются.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, req, reply) => {
    // Ошибки валидации схемы Fastify (если используется) — это 400 с понятным телом.
    if (error.validation) {
      return reply.status(400).send({ error: error.message, details: error.validation });
    }

    const status = error.statusCode ?? 500;

    // Клиентские ошибки (4xx) — сообщение безопасно отдать как есть
    // (это наши же reply.status(4xx) или ошибки плагинов: 401 guard, 413 лимит файла и т.п.).
    if (status >= 400 && status < 500) {
      return reply.status(status).send({ error: error.message });
    }

    // 5xx — необработанное исключение. Полную ошибку (с message/стеком) логируем на
    // сервере; клиенту — ТОЛЬКО общий текст, без деталей. Не завязываемся на NODE_ENV:
    // это fail-open (случайный не-prod в проде = утечка внутренностей наружу). Для отладки
    // в dev смотри серверный лог ниже — там полный `err`.
    req.log.error(
      { err: error, reqId: req.id, method: req.method, url: req.url },
      "Необработанная ошибка запроса",
    );
    return reply.status(status >= 500 ? status : 500).send({
      error: "Внутренняя ошибка сервера",
    });
  });

  // Единый формат для несуществующих маршрутов (а не дефолтный Fastify-объект).
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: `Маршрут не найден: ${req.method} ${req.url}` });
  });
}
