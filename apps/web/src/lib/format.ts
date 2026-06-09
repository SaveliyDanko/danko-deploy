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

/**
 * Переводит ведущие UTC-метки `docker logs --timestamps` в GMT+3 построчно.
 * Docker ставит в начало каждой строки метку вида "2026-06-09T10:12:01.506592110Z "
 * (всегда UTC). Заменяем ТОЛЬКО эту ведущую метку на локальное время GMT+3
 * ("2026-06-09 13:12:01.506"), не трогая остальной текст строки (там могут быть
 * свои таймстампы приложения). Строки без ведущей ISO-метки остаются как есть.
 */
const DOCKER_TS_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z (.*)$/;

export function localizeLogTimestamps(logs: string): string {
  return logs
    .split("\n")
    .map((line) => {
      const m = DOCKER_TS_RE.exec(line);
      if (!m) return line;
      const [, , , frac = "", rest] = m;
      const d = new Date(line.slice(0, line.indexOf(" ")));
      if (Number.isNaN(d.getTime())) return line;
      // Дата+время в GMT+3 (en-CA даёт ISO-подобный формат YYYY-MM-DD, HH:MM:SS).
      const local = d
        .toLocaleString("en-CA", {
          timeZone: DISPLAY_TIME_ZONE,
          hour12: false,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        .replace(", ", " ");
      // Сохраняем миллисекунды из исходной метки (первые 3 знака дробной части).
      const ms = frac ? frac.slice(0, 4) : "";
      return `${local}${ms} ${rest}`;
    })
    .join("\n");
}
