import { z } from "zod";

import { metricsSnapshotSchema } from "./metrics.js";

/**
 * Тип VPN-стека для раскатки на сервер. Пока поддержан только Outline (Shadowsocks);
 * enum оставлен расширяемым (wg-easy/wireguard и др. — на будущих итерациях).
 */
export const vpnKindSchema = z.enum(["outline"]);
export type VpnKind = z.infer<typeof vpnKindSchema>;

/**
 * Статус VPN-инсталляции:
 * - "installing": идёт раскатка (фоновая операция, лог в WS deploy:<runId>)
 * - "active": развёрнут и контейнер запущен
 * - "error": раскатка/проверка завершились ошибкой (см. lastError)
 * - "removed": удалён с сервера (строка может остаться для истории)
 */
export const vpnStatusSchema = z.enum(["installing", "active", "error", "removed"]);
export type VpnStatus = z.infer<typeof vpnStatusSchema>;

/** Тело запроса на раскатку VPN на уже добавленный сервер. */
export const createVpnInstallationSchema = z.object({
  serverId: z.string().min(1, "Укажите сервер"),
  kind: vpnKindSchema.default("outline"),
  /** Желаемый порт management API (опц.; по умолчанию выбирает install-скрипт) */
  apiPort: z.number().int().min(1).max(65535).optional(),
});
export type CreateVpnInstallationInput = z.infer<typeof createVpnInstallationSchema>;

/**
 * Публичное представление VPN-инсталляции (без секретов) — то, что уходит на фронт.
 * apiUrl (management-токен Outline) и certSha256 наружу НЕ отдаются.
 */
export const vpnInstallationPublicSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  kind: vpnKindSchema,
  status: vpnStatusSchema,
  host: z.string(),
  apiPort: z.number().nullable(),
  /** true, если есть расшифровываемый management-доступ (apiUrl сохранён) */
  managed: z.boolean(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VpnInstallationPublic = z.infer<typeof vpnInstallationPublicSchema>;

/** Одна проверка готовности сервера к раскатке VPN. */
export const vpnReadinessCheckSchema = z.object({
  /** Машинное имя проверки (tun/ip_forward/root/port/curl) */
  name: z.string(),
  /** Человекочитаемая подпись */
  label: z.string(),
  ok: z.boolean(),
  /** Деталь/пояснение (что нашли) */
  detail: z.string().optional(),
});
export type VpnReadinessCheck = z.infer<typeof vpnReadinessCheckSchema>;

/** Тело запроса на проверку готовности сервера. */
export const checkVpnReadinessSchema = z.object({
  serverId: z.string().min(1, "Укажите сервер"),
});
export type CheckVpnReadinessInput = z.infer<typeof checkVpnReadinessSchema>;

/**
 * Результат readiness-проверки: агрегат булевых чеков + текущие метрики сервера
 * (CPU/RAM/диск). ok=true, если все обязательные проверки прошли.
 */
export const vpnReadinessSchema = z.object({
  ok: z.boolean(),
  checks: z.array(vpnReadinessCheckSchema),
  metrics: metricsSnapshotSchema.nullable(),
});
export type VpnReadiness = z.infer<typeof vpnReadinessSchema>;
