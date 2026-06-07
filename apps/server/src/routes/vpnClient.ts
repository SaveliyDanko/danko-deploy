import {
  changeVpnClientLocationSchema,
  checkVpnClientReadinessSchema,
  createVpnClientSchema,
  parseSubscriptionSchema,
} from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";

export function registerVpnClientRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/vpn-client", () => ctx.vpnClient.list());

  app.get("/api/vpn-client/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const client = ctx.vpnClient.getPublic(id);
    if (!client) return reply.status(404).send({ error: "VPN-клиент не найден" });
    return client;
  });

  // Готовность сервера к VPN-клиенту (sing-box/TUN + метрики).
  app.post("/api/vpn-client/readiness", async (req, reply) => {
    const parsed = checkVpnClientReadinessSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await ctx.vpnClient.checkReadiness(parsed.data.serverId);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Парс подписки → список локаций для выбора (без секретов).
  app.post("/api/vpn-client/parse", async (req, reply) => {
    const parsed = parseSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await ctx.vpnClient.parseSubscription(parsed.data.subscriptionUrl);
    if ("error" in result) return reply.status(400).send(result);
    return result;
  });

  // Включение VPN-клиента (фон; лог в WS deploy:<runId>).
  app.post("/api/vpn-client", (req, reply) => {
    const parsed = createVpnClientSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = ctx.vpnClient.install(parsed.data.serverId, parsed.data);
    if ("error" in result) return reply.status(400).send(result);
    ctx.vpnClientScheduler.reload();
    return result;
  });

  // Ручное обновление подписки (фон; лог в WS deploy:<runId>).
  app.post("/api/vpn-client/:id/sync", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.vpnClient.manualSync(id);
    if ("error" in result) return reply.status(400).send(result);
    return result;
  });

  // Повторное включение выключенного (removed) клиента (фон; лог в WS).
  app.post("/api/vpn-client/:id/enable", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.vpnClient.enable(id);
    if ("error" in result) return reply.status(400).send(result);
    ctx.vpnClientScheduler.reload();
    return result;
  });

  // Список локаций из сохранённой подписки клиента (для выпадашки на карточке).
  app.get("/api/vpn-client/:id/locations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.vpnClient.locations(id);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Смена локации у подключённого клиента (фон; лог в WS).
  app.post("/api/vpn-client/:id/location", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = changeVpnClientLocationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = ctx.vpnClient.changeLocation(id, parsed.data.selectedLabel);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Внешний IP сервера + гео (проверка, что трафик идёт через VPN и через какую страну).
  app.get("/api/vpn-client/:id/external-ip", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.vpnClient.exitInfo(id);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Проверка популярных сервисов (ChatGPT/Claude/Telegram) с сервера через VPN.
  app.get("/api/vpn-client/:id/services", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.vpnClient.checkServices(id);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Выключение VPN: гасит туннель, но карточка остаётся (status removed).
  app.post("/api/vpn-client/:id/disable", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.vpnClient.remove(id);
    if ("error" in result) return reply.status(404).send(result);
    ctx.vpnClientScheduler.reload();
    return result;
  });

  // Полное удаление: гасит туннель на сервере И убирает запись из БД.
  app.delete("/api/vpn-client/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.vpnClient.deleteRow(id);
    if ("error" in result) return reply.status(404).send(result);
    ctx.vpnClientScheduler.reload();
    return result;
  });
}
