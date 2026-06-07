import type { DirUsage, DockerUsageEntry, StorageBreakdown } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

import { parseDisks } from "./MetricsCollector.js";

const SEP = "===DANKO_STORAGE_SEP===";

/**
 * Команда детального разбора диска. Тяжелее обычных метрик (du по корню), поэтому
 * запускается ПО КНОПКЕ, а не в фоновом опросе.
 * - df: полный список ФС (фильтр тот же, что в метриках)
 * - docker system df: разбивка по images/containers/volumes/build-cache (байты)
 * - du -x -d1 /: размеры каталогов первого уровня (-x = не уходить на другие ФС)
 */
const STORAGE_CMD = [
  "df -PB1 | awk 'NR>1 && $1 !~ /tmpfs|udev|overlay|ramfs/ && $6 !~ /^\\/(run|dev|sys|proc)(\\/|$)/ {print $6, $2, $3, $5}'",
  `echo "${SEP}"`,
  // --format задаёт байты и reclaimable явно (не человекочитаемо), парсить надёжнее.
  'docker system df --format "{{.Type}}\\t{{.TotalCount}}\\t{{.Active}}\\t{{.Size}}\\t{{.Reclaimable}}" 2>/dev/null || true',
  `echo "${SEP}"`,
  // sudo по возможности — иначе du не прочитает чужие каталоги; ошибки гасим.
  "du -xb -d1 / 2>/dev/null | sort -rn | head -20 || true",
].join(" && ");

/**
 * Парсит вывод `docker system df --format` с явными байтами.
 * docker отдаёт размеры как "1.23GB" / "456MB" — переводим в байты.
 */
export function parseDockerDf(block: string): DockerUsageEntry[] {
  const out: DockerUsageEntry[] = [];
  for (const line of block.trim().split("\n")) {
    if (!line.trim()) continue;
    const [type, totalStr, activeStr, sizeStr, reclaimStr] = line.split("\t");
    if (!type) continue;
    out.push({
      type: type.trim(),
      total: Number(totalStr) || 0,
      active: Number(activeStr) || 0,
      sizeBytes: parseHumanSize(sizeStr),
      // Reclaimable вида "1.2GB (50%)" — берём только размер до скобки.
      reclaimableBytes: parseHumanSize((reclaimStr ?? "").split("(")[0]),
    });
  }
  return out;
}

/** Парсит вывод `du -b` (байты + путь): "12345\t/var". */
export function parseDu(block: string): DirUsage[] {
  const out: DirUsage[] = [];
  for (const line of block.trim().split("\n")) {
    if (!line.trim()) continue;
    const [sizeStr, ...rest] = line.trim().split(/\s+/);
    const sizeBytes = Number(sizeStr);
    const path = rest.join(" ");
    // Пропускаем сам корень "/" (это сумма) и битые строки.
    if (Number.isNaN(sizeBytes) || !path || path === "/") continue;
    out.push({ path, sizeBytes });
  }
  return out;
}

/**
 * Переводит человекочитаемый размер docker ("1.23GB", "456.7MB", "0B") в байты.
 * Возвращает 0 при пустой/нераспознанной строке.
 */
export function parseHumanSize(s: string | undefined): number {
  if (!s) return 0;
  const m = /^([\d.]+)\s*([KMGTP]?i?B|B)?$/i.exec(s.trim());
  if (!m) return 0;
  const value = Number(m[1]);
  if (Number.isNaN(value)) return 0;
  const unit = (m[2] ?? "B").toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    PB: 1e15,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    PIB: 1024 ** 5,
  };
  return Math.round(value * (mult[unit] ?? 1));
}

/** Собирает детальную разбивку диска сервера по SSH (тяжёлая, по кнопке). */
export class StorageCollector {
  constructor(private readonly ssh: SshExecutor) {}

  async collect(target: SshTarget): Promise<StorageBreakdown> {
    const { stdout } = await this.ssh.exec(target, STORAGE_CMD);
    const [diskBlock = "", dockerBlock = "", duBlock = ""] = stdout.split(SEP);
    return {
      serverId: target.id,
      collectedAt: new Date().toISOString(),
      disks: parseDisks(diskBlock),
      docker: parseDockerDf(dockerBlock),
      dirs: parseDu(duBlock),
    };
  }
}
