export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

/** Часовой пояс отображения дат в UI (GMT+3, без перехода на летнее время). */
const DISPLAY_TIME_ZONE = "Europe/Moscow";

/**
 * Форматирует дату для UI в часовом поясе GMT+3, независимо от пояса машины.
 * Источники времени:
 *  - new Date().toISOString() на бэкенде → строка с суффиксом Z (UTC) — парсится однозначно;
 *  - SQLite current_timestamp ("YYYY-MM-DD HH:MM:SS", тоже UTC, но БЕЗ Z) — `new Date()`
 *    распарсил бы её как локальное время, поэтому такую форму нормализуем в UTC вручную.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // SQLite current_timestamp: "2026-06-09 21:40:05" (без T и без Z) — это UTC, помечаем как UTC.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)
    ? iso.replace(" ", "T") + "Z"
    : iso;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  });
}
