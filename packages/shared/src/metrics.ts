import { z } from "zod";

/** Загрузка по дискам (один раздел) */
export const diskUsageSchema = z.object({
  mount: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  usePercent: z.number(),
});
export type DiskUsage = z.infer<typeof diskUsageSchema>;

/**
 * Запущенный docker-контейнер. Базовые поля — из `docker ps`; поля нагрузки
 * (cpu/mem) — из `docker stats --no-stream`, могут быть null, если stats недоступен.
 */
export const containerInfoSchema = z.object({
  name: z.string(),
  image: z.string(),
  status: z.string(),
  /** Загрузка CPU контейнером, % (из docker stats; может быть >100% на многоядерных) */
  cpuPercent: z.number().nullable().default(null),
  /** Использовано памяти контейнером, МБ */
  memUsedMb: z.number().nullable().default(null),
  /** Лимит памяти контейнера, МБ (обычно вся RAM хоста, если лимит не задан) */
  memLimitMb: z.number().nullable().default(null),
  /** Доля памяти от лимита, % */
  memPercent: z.number().nullable().default(null),
});
export type ContainerInfo = z.infer<typeof containerInfoSchema>;

/**
 * Слушающий (LISTEN) порт на хосте — из `ss -tlnp`. Покрывает и docker, и
 * не-docker сервисы. process может быть null, если имя процесса недоступно
 * (нет root) или не распозналось.
 */
export const listeningPortSchema = z.object({
  /** Номер порта */
  port: z.number(),
  /** Протокол (tcp/udp) */
  proto: z.string(),
  /** Адрес привязки: 0.0.0.0/:: = доступен снаружи, 127.0.0.1 = только локально */
  address: z.string(),
  /** Имя процесса/контейнера, держащего порт (best-effort) */
  process: z.string().nullable().default(null),
});
export type ListeningPort = z.infer<typeof listeningPortSchema>;

/**
 * Снимок метрик сервера, собранный по SSH одной пачкой команд.
 * cpuPercent — усреднённая загрузка из top; memUsed/Total — из free -m (в МБ).
 */
export const metricsSnapshotSchema = z.object({
  serverId: z.string(),
  collectedAt: z.string(),
  cpuPercent: z.number().nullable(),
  loadAvg: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  memUsedMb: z.number().nullable(),
  memTotalMb: z.number().nullable(),
  uptimeSeconds: z.number().nullable(),
  disks: z.array(diskUsageSchema),
  containers: z.array(containerInfoSchema),
  /** Слушающие порты хоста (LISTEN). Пустой массив, если ss недоступен. */
  ports: z.array(listeningPortSchema).default([]),
});
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;

/**
 * Снимок логов контейнера (docker logs --tail). Запрашивается по кнопке с дашборда,
 * не стримится — отдаётся последний кусок логов разом.
 */
export const containerLogsSchema = z.object({
  /** Имя контейнера */
  name: z.string(),
  /** Сколько последних строк запрошено */
  tail: z.number(),
  /** Текст логов (stdout+stderr, с временными метками docker) */
  logs: z.string(),
});
export type ContainerLogs = z.infer<typeof containerLogsSchema>;
