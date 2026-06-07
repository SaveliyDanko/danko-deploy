import { z } from "zod";

import { metricsSnapshotSchema } from "./metrics.js";
import { vpnReadinessCheckSchema } from "./vpn.js";

/**
 * Статус VPN-клиента (sing-box на сервере, гонит трафик через провайдера):
 * - "installing": идёт раскатка (фон, лог в WS deploy:<runId>)
 * - "active": туннель поднят
 * - "syncing": идёт авто-обновление подписки (перезапись конфига)
 * - "error": раскатка/sync завершились ошибкой
 * - "removed": выключен и снят с сервера
 */
export const vpnClientStatusSchema = z.enum([
  "installing",
  "active",
  "syncing",
  "error",
  "removed",
]);
export type VpnClientStatus = z.infer<typeof vpnClientStatusSchema>;

/**
 * Один сервер из распарсенной подписки — БЕЗ секретов (uuid/ключи не отдаём наружу).
 * Используется для выбора локации в UI.
 */
export const vpnClientServerSchema = z.object({
  /** Человекочитаемая метка локации (из #fragment URI), напр. "🇱🇻 Латвия" */
  label: z.string(),
  host: z.string(),
  port: z.number(),
  protocol: z.literal("vless"),
  /** Порядковый индекс в подписке (для уникальности при одинаковых label) */
  index: z.number(),
});
export type VpnClientServer = z.infer<typeof vpnClientServerSchema>;

/** Тело запроса «спарсить подписку и показать список локаций». */
export const parseSubscriptionSchema = z.object({
  subscriptionUrl: z.string().url("Укажите корректную ссылку подписки"),
});
export type ParseSubscriptionInput = z.infer<typeof parseSubscriptionSchema>;

/** Тело запроса на включение VPN-клиента на сервере. */
export const createVpnClientSchema = z.object({
  serverId: z.string().min(1, "Укажите сервер"),
  subscriptionUrl: z.string().url("Укажите корректную ссылку подписки"),
  /** Выбранная локация (матчим по label при авто-обновлении подписки) */
  selectedLabel: z.string().min(1, "Выберите локацию"),
  /** cron-выражение авто-обновления подписки (опц.; дефолт на бэке) */
  syncCron: z.string().optional(),
});
export type CreateVpnClientInput = z.infer<typeof createVpnClientSchema>;

/** Тело запроса на проверку готовности сервера к VPN-клиенту. */
export const checkVpnClientReadinessSchema = z.object({
  serverId: z.string().min(1, "Укажите сервер"),
});
export type CheckVpnClientReadinessInput = z.infer<typeof checkVpnClientReadinessSchema>;

/** Тело запроса на смену локации у подключённого клиента. */
export const changeVpnClientLocationSchema = z.object({
  selectedLabel: z.string().min(1, "Выберите локацию"),
});
export type ChangeVpnClientLocationInput = z.infer<typeof changeVpnClientLocationSchema>;

/**
 * Публичное представление VPN-клиента (без зашифрованной ссылки подписки).
 * `externalIp` — внешний IP сервера после включения VPN (для проверки в UI, что
 * трафик реально идёт через туннель: IP ≠ host сервера).
 */
export const vpnClientPublicSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  status: vpnClientStatusSchema,
  selectedLabel: z.string(),
  host: z.string(),
  externalIp: z.string().nullable(),
  lastError: z.string().nullable(),
  syncCron: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VpnClientPublic = z.infer<typeof vpnClientPublicSchema>;

/** Результат readiness-проверки сервера к sing-box (чеки + текущие метрики). */
export const vpnClientReadinessSchema = z.object({
  ok: z.boolean(),
  checks: z.array(vpnReadinessCheckSchema),
  metrics: metricsSnapshotSchema.nullable(),
});
export type VpnClientReadiness = z.infer<typeof vpnClientReadinessSchema>;

/**
 * Результат проверки внешнего IP сервера: host сервера (исходный), текущий внешний
 * IP (через VPN, если поднят) + гео. Если externalIp ≠ host — трафик идёт через VPN.
 */
export const vpnClientExitInfoSchema = z.object({
  /** Host/IP сервера (как подключается панель) — точка отсчёта. */
  serverHost: z.string(),
  /** Текущий внешний IP, с которым сервер выходит в интернет. */
  externalIp: z.string().nullable(),
  /** Код страны выхода (ISO, напр. "LV"). */
  country: z.string().nullable(),
  /** Провайдер/AS выхода (напр. "AS12345 Some ISP"). */
  org: z.string().nullable(),
  /** true, если externalIp отличается от serverHost (трафик идёт через VPN). */
  throughVpn: z.boolean(),
});
export type VpnClientExitInfo = z.infer<typeof vpnClientExitInfoSchema>;

/** Результат проверки одного сервиса (ChatGPT/Claude/Telegram) с сервера. */
export const vpnServiceCheckSchema = z.object({
  name: z.string(),
  reachable: z.boolean(),
  detail: z.string(),
});
export type VpnServiceCheck = z.infer<typeof vpnServiceCheckSchema>;
