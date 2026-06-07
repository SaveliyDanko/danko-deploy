import type {
  ContainerInfo,
  DiskUsage,
  ListeningPort,
  MetricsSnapshot,
} from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/**
 * Разделитель между блоками вывода. Собираем все метрики ОДНОЙ ssh-командой,
 * чтобы не открывать несколько сессий — это и быстрее, и дешевле для сервера.
 */
const SEP = "===DANKO_SEP===";

/**
 * Команда собирает: load/uptime, память, диски, docker ps. Каждый блок
 * отделён маркером. `2>/dev/null || true` — чтобы отсутствие docker не ломало всё.
 */
const COLLECT_CMD = [
  "cat /proc/loadavg",
  `echo "${SEP}"`,
  "cat /proc/uptime",
  `echo "${SEP}"`,
  "free -m | awk 'NR==2{print $2, $3}'",
  `echo "${SEP}"`,
  "df -PB1 | awk 'NR>1 && $1 !~ /tmpfs|udev|overlay/ {print $6, $2, $3, $5}'",
  `echo "${SEP}"`,
  'docker ps --format "{{.Names}}\\t{{.Image}}\\t{{.Status}}" 2>/dev/null || true',
  `echo "${SEP}"`,
  // Нагрузка по контейнерам одной командой (без стрима): CPU% и MemUsage (used / limit).
  'docker stats --no-stream --format "{{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}" 2>/dev/null || true',
  `echo "${SEP}"`,
  // Слушающие порты хоста (tcp+udp, LISTEN). -p даёт процесс (нужен root для чужих).
  "ss -H -tulnp 2>/dev/null || true",
].join(" && ");

function parseLoadAvg(block: string): {
  loadAvg: [number, number, number] | null;
} {
  const parts = block.trim().split(/\s+/);
  if (parts.length < 3) return { loadAvg: null };
  const [a, b, c] = parts.map(Number);
  if ([a, b, c].some((n) => Number.isNaN(n))) return { loadAvg: null };
  return { loadAvg: [a!, b!, c!] };
}

function parseUptime(block: string): number | null {
  const first = block.trim().split(/\s+/)[0];
  const v = Number(first);
  return Number.isNaN(v) ? null : Math.round(v);
}

function parseMem(block: string): { total: number | null; used: number | null } {
  const [total, used] = block.trim().split(/\s+/).map(Number);
  return {
    total: Number.isNaN(total) ? null : total!,
    used: Number.isNaN(used) ? null : used!,
  };
}

function parseDisks(block: string): DiskUsage[] {
  const disks: DiskUsage[] = [];
  for (const line of block.trim().split("\n")) {
    if (!line.trim()) continue;
    const [mount, totalStr, usedStr, pctStr] = line.trim().split(/\s+/);
    const totalBytes = Number(totalStr);
    const usedBytes = Number(usedStr);
    const usePercent = Number((pctStr ?? "").replace("%", ""));
    if (!mount || Number.isNaN(totalBytes)) continue;
    disks.push({
      mount,
      totalBytes,
      usedBytes: Number.isNaN(usedBytes) ? 0 : usedBytes,
      usePercent: Number.isNaN(usePercent) ? 0 : usePercent,
    });
  }
  return disks;
}

function parseContainers(block: string): ContainerInfo[] {
  const containers: ContainerInfo[] = [];
  for (const line of block.trim().split("\n")) {
    if (!line.trim()) continue;
    const [name, image, status] = line.split("\t");
    if (!name) continue;
    containers.push({
      name,
      image: image ?? "",
      status: status ?? "",
      cpuPercent: null,
      memUsedMb: null,
      memLimitMb: null,
      memPercent: null,
    });
  }
  return containers;
}

/** Переводит размер из docker stats (123.4MiB / 1.9GiB / 512KiB / 10B) в МБ. */
function toMb(raw: string): number | null {
  const m = raw.trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!m) return null;
  const val = Number(m[1]);
  if (Number.isNaN(val)) return null;
  const unit = m[2]!.toLowerCase();
  const factorMb: Record<string, number> = {
    b: 1 / (1024 * 1024),
    kib: 1 / 1024,
    kb: 1 / 1024,
    mib: 1,
    mb: 1,
    gib: 1024,
    gb: 1024,
    tib: 1024 * 1024,
    tb: 1024 * 1024,
  };
  const f = factorMb[unit];
  return f === undefined ? null : Math.round(val * f * 10) / 10;
}

/**
 * Парсит `docker stats --no-stream` (name, CPU%, "used / limit") и мёрджит нагрузку
 * в уже собранный список контейнеров по имени. Контейнеры без stats остаются с null.
 */
function mergeContainerStats(containers: ContainerInfo[], block: string): void {
  const byName = new Map(containers.map((c) => [c.name, c]));
  for (const line of block.trim().split("\n")) {
    if (!line.trim()) continue;
    const [name, cpuStr, memStr] = line.split("\t");
    const c = name ? byName.get(name) : undefined;
    if (!c) continue;

    const cpu = Number((cpuStr ?? "").replace("%", "").trim());
    c.cpuPercent = Number.isNaN(cpu) ? null : cpu;

    // memStr: "123.4MiB / 1.9GiB"
    const [usedRaw, limitRaw] = (memStr ?? "").split("/");
    c.memUsedMb = usedRaw ? toMb(usedRaw) : null;
    c.memLimitMb = limitRaw ? toMb(limitRaw) : null;
    c.memPercent =
      c.memUsedMb != null && c.memLimitMb && c.memLimitMb > 0
        ? Math.round((c.memUsedMb / c.memLimitMb) * 1000) / 10
        : null;
  }
}

/**
 * Парсит `ss -H -tulnp`. Каждая строка:
 *   tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=12,fd=6))
 * Берём протокол, локальный адрес:порт и имя процесса (best-effort, нужен root).
 * UDP-строки не имеют состояния LISTEN — для них фильтруем по наличию users/порта.
 */
function parsePorts(block: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  const seen = new Set<string>();

  for (const line of block.trim().split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const cols = t.split(/\s+/);
    if (cols.length < 5) continue;

    const proto = cols[0]!.toLowerCase(); // tcp | udp
    if (proto !== "tcp" && proto !== "udp") continue;
    // У tcp колонка состояния = LISTEN; у udp — UNCONN. Локальный адрес — предпоследняя
    // пара перед peer-адресом: ss -tlnp кладёт его в поле «Local Address:Port».
    // Поля: Netid State Recv-Q Send-Q Local Peer [process]
    const local = cols[4];
    if (!local) continue;

    // Разбираем addr:port (IPv6 в скобках: [::]:80). Порт — после последнего ':'.
    const idx = local.lastIndexOf(":");
    if (idx < 0) continue;
    const address = local.slice(0, idx).replace(/^\[|\]$/g, "");
    const port = Number(local.slice(idx + 1));
    if (Number.isNaN(port) || port === 0) continue;

    // Имя процесса из users:(("name",pid=..,..))
    const procMatch = t.match(/users:\(\("([^"]+)"/);
    const process = procMatch ? procMatch[1]! : null;

    // Дедуп по proto+address+port (ss может дублировать строки).
    const key = `${proto}:${address}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    ports.push({ port, proto, address, process });
  }

  // Сортируем по номеру порта — удобнее анализировать.
  ports.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
  return ports;
}

/**
 * Считает CPU% из loadAvg(1м), нормируя на число ядер.
 * Это грубая оценка (load != cpu), но "без агента" точнее одной командой не получить
 * без двух замеров top с паузой. Достаточно для дашборда.
 */
function estimateCpuPercent(load1: number, cores: number): number {
  if (cores <= 0) return 0;
  return Math.min(100, Math.round((load1 / cores) * 100));
}

/** Собирает снимок метрик сервера по SSH. */
export class MetricsCollector {
  constructor(private readonly ssh: SshExecutor) {}

  async collect(target: SshTarget): Promise<MetricsSnapshot> {
    const { stdout } = await this.ssh.exec(target, COLLECT_CMD);
    const [
      loadBlock = "",
      uptimeBlock = "",
      memBlock = "",
      diskBlock = "",
      dockerBlock = "",
      statsBlock = "",
      portsBlock = "",
    ] = stdout.split(SEP);

    const { loadAvg } = parseLoadAvg(loadBlock);
    const mem = parseMem(memBlock);

    // Число ядер берём из nproc лениво только если есть load — отдельной дешёвой командой.
    let cores = 1;
    if (loadAvg) {
      const nproc = await this.ssh.exec(target, "nproc");
      const n = Number(nproc.stdout.trim());
      if (!Number.isNaN(n) && n > 0) cores = n;
    }

    const containers = parseContainers(dockerBlock);
    mergeContainerStats(containers, statsBlock); // нагрузка cpu/mem по контейнерам

    return {
      serverId: target.id,
      collectedAt: new Date().toISOString(),
      cpuPercent: loadAvg ? estimateCpuPercent(loadAvg[0], cores) : null,
      loadAvg,
      memUsedMb: mem.used,
      memTotalMb: mem.total,
      uptimeSeconds: parseUptime(uptimeBlock),
      disks: parseDisks(diskBlock),
      containers,
      ports: parsePorts(portsBlock),
    };
  }
}
