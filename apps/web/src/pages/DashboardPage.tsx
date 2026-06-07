import type {
  ContainerInfo,
  DockerUsageEntry,
  ListeningPort,
  MetricsSnapshot,
  ServerPublic,
  VpnClientPublic,
  VpnInstallationPublic,
  WsClientMessage,
} from "@dankodeploy/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, MeterBar, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatBytes, formatDate, formatUptime } from "../lib/format.js";
import { useWebSocket } from "../lib/ws.js";

export function DashboardPage() {
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });
  // Последние сохранённые снимки — приходят сразу, чтобы не ждать первого WS-сообщения.
  const cached = useQuery({ queryKey: ["metrics-last"], queryFn: api.lastMetrics });
  // VPN-состояние сервера: Outline (сервер раздаёт VPN) и клиент (сервер ходит через VPN).
  const vpn = useQuery({ queryKey: ["vpn"], queryFn: api.listVpn });
  const vpnClients = useQuery({ queryKey: ["vpnClient"], queryFn: api.listVpnClients });

  // Индексы по serverId для быстрого показа на карточке.
  const vpnByServer = useMemo(() => {
    const m = new Map<string, VpnInstallationPublic>();
    for (const v of vpn.data ?? []) m.set(v.serverId, v);
    return m;
  }, [vpn.data]);
  const vpnClientByServer = useMemo(() => {
    const m = new Map<string, VpnClientPublic>();
    for (const c of vpnClients.data ?? []) m.set(c.serverId, c);
    return m;
  }, [vpnClients.data]);

  // Какие снимки «живые» (пришли по WS в этой сессии), а какие — из кэша БД.
  const [snapshots, setSnapshots] = useState<Record<string, MetricsSnapshot>>({});
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());

  // Засеиваем кэшированными снимками всё, что ещё не обновилось по WS.
  useEffect(() => {
    if (!cached.data) return;
    setSnapshots((prev) => {
      const next = { ...prev };
      for (const snap of cached.data) {
        if (!next[snap.serverId]) next[snap.serverId] = snap;
      }
      return next;
    });
  }, [cached.data]);

  const subscribe = useMemo<WsClientMessage[]>(
    () => (servers.data ?? []).map((s) => ({ type: "subscribe:metrics", serverId: s.id })),
    [servers.data],
  );

  useWebSocket(
    subscribe,
    (msg) => {
      if (msg.type === "metrics:update") {
        const snap = msg.snapshot as MetricsSnapshot;
        setSnapshots((prev) => ({ ...prev, [msg.serverId]: snap }));
        setLiveIds((prev) => (prev.has(msg.serverId) ? prev : new Set(prev).add(msg.serverId)));
      }
    },
    (servers.data?.length ?? 0) > 0,
  );

  if (servers.isLoading) return <Spinner />;
  if (!servers.data?.length)
    return (
      <EmptyState text="Нет серверов для мониторинга. Добавьте сервер на вкладке «Серверы»." />
    );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Дашборд</h1>
      <p className="text-sm text-slate-400">
        Сразу показываются последние сохранённые метрики, затем они обновляются вживую по
        WebSocket (~каждые 5 секунд, собираются по SSH).
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {servers.data.map((s) => (
          <ServerCard
            key={s.id}
            server={s}
            snapshot={snapshots[s.id]}
            live={liveIds.has(s.id)}
            vpn={vpnByServer.get(s.id)}
            vpnClient={vpnClientByServer.get(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ServerCard({
  server,
  snapshot,
  live,
  vpn,
  vpnClient,
}: {
  server: ServerPublic;
  snapshot: MetricsSnapshot | undefined;
  live: boolean;
  vpn: VpnInstallationPublic | undefined;
  vpnClient: VpnClientPublic | undefined;
}) {
  const memPercent =
    snapshot?.memUsedMb != null && snapshot.memTotalMb
      ? (snapshot.memUsedMb / snapshot.memTotalMb) * 100
      : 0;

  // Имя контейнера, для которого открыта модалка логов (null — закрыта).
  const [logsContainer, setLogsContainer] = useState<string | null>(null);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{server.name}</span>
            {snapshot &&
              (live ? (
                <span className="badge bg-emerald-500/15 text-emerald-400" title="Данные обновляются вживую">
                  ● live
                </span>
              ) : (
                <span
                  className="badge bg-slate-500/15 text-slate-400"
                  title={`Сохранённые данные от ${formatDate(snapshot.collectedAt)}`}
                >
                  сохранённые
                </span>
              ))}
          </div>
          <div className="text-xs text-slate-400">
            {server.username}@{server.host}
          </div>
        </div>
        {snapshot ? (
          <div className="text-right text-xs text-slate-500">
            <div>uptime {formatUptime(snapshot.uptimeSeconds)}</div>
            {!live && <div>обновлено {formatDate(snapshot.collectedAt)}</div>}
          </div>
        ) : (
          <Spinner />
        )}
      </div>

      {/* VPN-состояние сервера (Outline-сервер и/или VPN-клиент) */}
      {(vpn || vpnClient) && (
        <Section title="VPN">
          <div className="space-y-1.5">
            {vpn && <VpnServerRow vpn={vpn} />}
            {vpnClient && <VpnClientRow client={vpnClient} />}
          </div>
        </Section>
      )}

      {snapshot && (
        <>
          {/* Ресурсы хоста */}
          <Section title="Ресурсы">
            <div className="space-y-2">
              <MeterBar label="CPU" percent={snapshot.cpuPercent ?? 0} />
              <MeterBar
                label={`RAM ${formatBytes((snapshot.memUsedMb ?? 0) * 1024 * 1024)} / ${formatBytes(
                  (snapshot.memTotalMb ?? 0) * 1024 * 1024,
                )}`}
                percent={memPercent}
              />
              {/* Только корневой диск; остальные ФС — в секции «Хранилище». */}
              {snapshot.disks
                .filter((d) => d.mount === "/")
                .map((d) => (
                  <MeterBar
                    key={d.mount}
                    label={`Диск ${d.mount} — ${formatBytes(d.usedBytes)} / ${formatBytes(
                      d.totalBytes,
                    )} (свободно ${formatBytes(d.totalBytes - d.usedBytes)})`}
                    percent={d.usePercent}
                  />
                ))}
            </div>
          </Section>

          {/* Контейнеры */}
          {(snapshot.containers?.length ?? 0) > 0 && (
            <Section title={`Контейнеры (${snapshot.containers.length})`}>
              <div className="space-y-1.5">
                {snapshot.containers.map((c) => (
                  <ContainerRow key={c.name} c={c} onLogs={() => setLogsContainer(c.name)} />
                ))}
              </div>
            </Section>
          )}

          {/* Порты (сворачиваемый блок со своим заголовком) */}
          {(snapshot.ports?.length ?? 0) > 0 && <PortsBlock ports={snapshot.ports} />}

          {/* Хранилище: детальная разбивка диска по кнопке (df + docker df + du) */}
          <StorageSection serverId={server.id} />
        </>
      )}

      {logsContainer && (
        <ContainerLogsModal
          serverId={server.id}
          name={logsContainer}
          onClose={() => setLogsContainer(null)}
        />
      )}

      <div className="pt-1">
        <Link to="/projects" className="text-xs text-indigo-400 hover:underline">
          Проекты на этом сервере →
        </Link>
      </div>
    </div>
  );
}

/**
 * Визуальная секция внутри карточки сервера: разделительная линия сверху +
 * подзаголовок. Помогает интуитивно отделить «Ресурсы / Контейнеры / Порты».
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-edge pt-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}

/** Цвет бейджа по статусу VPN: активен — зелёный, ошибка — красный, иначе — серый. */
function vpnBadgeClass(status: string): string {
  if (status === "active") return "bg-emerald-500/15 text-emerald-400";
  if (status === "error") return "bg-rose-500/15 text-rose-400";
  if (status === "installing" || status === "syncing") return "bg-amber-500/15 text-amber-400";
  return "bg-slate-500/15 text-slate-400";
}

/** Строка VPN-сервера (Outline): сервер раздаёт VPN-доступ. */
function VpnServerRow({ vpn }: { vpn: VpnInstallationPublic }) {
  const labels: Record<string, string> = {
    active: "активен",
    installing: "раскатка…",
    error: "ошибка",
    removed: "удалён",
  };
  return (
    <Link
      to="/vpn"
      className="flex items-center justify-between rounded-md bg-edge/40 px-2 py-1.5 text-xs hover:bg-edge/70"
      title={vpn.lastError ?? undefined}
    >
      <span className="flex items-center gap-2">
        <span className="text-slate-300">🛡️ VPN-сервер (Outline)</span>
      </span>
      <span className={`badge ${vpnBadgeClass(vpn.status)}`}>{labels[vpn.status] ?? vpn.status}</span>
    </Link>
  );
}

/** Строка VPN-клиента (sing-box): сервер ходит в интернет через VPN. */
function VpnClientRow({ client }: { client: VpnClientPublic }) {
  const labels: Record<string, string> = {
    active: "активен",
    installing: "включение…",
    syncing: "обновление…",
    error: "ошибка",
    removed: "выключен",
  };
  return (
    <Link
      to="/vpn-client"
      className="flex items-center justify-between gap-2 rounded-md bg-edge/40 px-2 py-1.5 text-xs hover:bg-edge/70"
      title={client.lastError ?? undefined}
    >
      <span className="min-w-0 truncate text-slate-300">
        🌍 VPN-клиент → <span className="text-slate-400">{client.selectedLabel}</span>
        {client.status === "active" && client.externalIp && (
          <span className="text-slate-500"> · IP {client.externalIp}</span>
        )}
      </span>
      <span className={`badge shrink-0 ${vpnBadgeClass(client.status)}`}>
        {labels[client.status] ?? client.status}
      </span>
    </Link>
  );
}

/** Форматирует объём из МБ: <1024 → «512 МБ», иначе «1.9 ГБ». */
function formatMb(mb: number | null): string {
  if (mb == null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} ГБ` : `${Math.round(mb)} МБ`;
}

/**
 * Карточка контейнера с нагрузкой: имя сверху, под ним CPU и RAM одна под другой —
 * так метрики выровнены по вертикали и удобнее сравнивать между контейнерами.
 * Нагрузка может быть null, если docker stats недоступен.
 */
function ContainerRow({ c, onLogs }: { c: ContainerInfo; onLogs: () => void }) {
  const hasLoad = c.cpuPercent != null || c.memUsedMb != null;

  return (
    <div
      className="rounded-md bg-edge/40 px-2 py-1.5 text-xs"
      title={`${c.image} · ${c.status}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-slate-300">{c.name}</span>
        <button
          className="flex shrink-0 items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[11px] font-medium text-indigo-200 transition hover:bg-indigo-500/30 hover:text-white"
          title="Показать последние логи контейнера"
          onClick={onLogs}
        >
          <span aria-hidden>📄</span> Логи
        </button>
      </div>

      {hasLoad ? (
        <div className="mt-1 space-y-1">
          {c.cpuPercent != null && (
            <MeterBar label={`CPU ${c.cpuPercent.toFixed(1)}%`} percent={c.cpuPercent} />
          )}
          {c.memUsedMb != null && (
            <MeterBar
              label={`RAM ${formatMb(c.memUsedMb)}${
                c.memLimitMb != null ? ` / ${formatMb(c.memLimitMb)}` : ""
              }`}
              percent={c.memPercent ?? 0}
            />
          )}
        </div>
      ) : (
        <div className="mt-0.5 text-slate-500">{c.status || "—"}</div>
      )}
    </div>
  );
}

/** Публичный ли адрес привязки (доступен снаружи): 0.0.0.0, :: или *. */
function isPublicBind(address: string): boolean {
  return address === "0.0.0.0" || address === "::" || address === "*";
}

/** Слушающие порты хоста — одна строка на порт, публичные помечены. Сворачиваемый блок. */
function PortsBlock({ ports }: { ports: ListeningPort[] }) {
  // Свёрнуто по умолчанию — список портов может быть длинным и оттеснять метрики.
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-edge pt-3">
      <button
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className="text-[10px] text-slate-500 transition-transform"
          style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}
        >
          ▶
        </span>
        <span className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">
          Открытые порты ({ports.length})
        </span>
      </button>
      {open && (
      <div className="mt-2 space-y-1">
        {ports.map((p) => {
          const isPublic = isPublicBind(p.address);
          return (
            <div
              key={`${p.proto}:${p.address}:${p.port}`}
              className="flex items-center justify-between rounded-md bg-edge/40 px-2 py-1 text-xs"
              title={`${p.proto.toUpperCase()} ${p.address}:${p.port}${
                p.process ? ` · ${p.process}` : ""
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono font-semibold text-slate-200">{p.port}</span>
                <span className="uppercase text-slate-500">{p.proto}</span>
                <span
                  className={isPublic ? "text-amber-400" : "text-slate-500"}
                  title={isPublic ? "Доступен снаружи" : "Только локально"}
                >
                  {isPublic ? "публичный" : "локальный"}
                </span>
              </span>
              <span className="truncate pl-2 font-mono text-slate-400">{p.process ?? "—"}</span>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

/**
 * Хранилище: детальная разбивка диска по кнопке (тяжёлые df + docker system df + du).
 * Свёрнуто по умолчанию; данные грузятся только при первом раскрытии и по «Обновить»,
 * чтобы не нагружать sshd сервера на каждый рендер дашборда.
 */
function StorageSection({ serverId }: { serverId: string }) {
  const [open, setOpen] = useState(false);
  const storage = useMutation({ mutationFn: () => api.serverStorage(serverId) });

  // Грузим при первом раскрытии (если ещё нет данных и не идёт загрузка).
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !storage.data && !storage.isPending) storage.mutate();
  }

  const data = storage.data;
  return (
    <div className="border-t border-edge pt-3">
      <button
        className="flex w-full items-center gap-1.5 text-left"
        onClick={toggle}
        aria-expanded={open}
      >
        <span
          className="text-[10px] text-slate-500 transition-transform"
          style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}
        >
          ▶
        </span>
        <span className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">
          Хранилище
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost px-2 py-0.5 text-xs"
              onClick={() => storage.mutate()}
              disabled={storage.isPending}
            >
              {storage.isPending ? "Сбор…" : "Обновить"}
            </button>
            {data && (
              <span className="text-[10px] text-slate-500">
                собрано {formatDate(data.collectedAt)}
              </span>
            )}
          </div>

          {storage.isError && (
            <div className="text-xs text-rose-400">
              {storage.error instanceof Error ? storage.error.message : "Ошибка сбора"}
            </div>
          )}

          {data && (
            <>
              {/* Файловые системы — объём и заполнение */}
              <div className="space-y-2">
                {data.disks.map((d) => (
                  <MeterBar
                    key={d.mount}
                    label={`${d.mount} — ${formatBytes(d.usedBytes)} / ${formatBytes(
                      d.totalBytes,
                    )} (свободно ${formatBytes(d.totalBytes - d.usedBytes)})`}
                    percent={d.usePercent}
                  />
                ))}
              </div>

              {/* Docker по категориям */}
              {data.docker.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                    Docker
                  </div>
                  <div className="space-y-1">
                    {data.docker.map((d) => (
                      <DockerUsageRow key={d.type} d={d} />
                    ))}
                  </div>
                </div>
              )}

              {/* Топ каталогов */}
              {data.dirs.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                    Крупные каталоги
                  </div>
                  <div className="space-y-1">
                    {data.dirs.slice(0, 10).map((d) => (
                      <div
                        key={d.path}
                        className="flex items-center justify-between rounded-md bg-edge/40 px-2 py-1 text-xs"
                      >
                        <span className="truncate font-mono text-slate-300">{d.path}</span>
                        <span className="pl-2 text-slate-400">{formatBytes(d.sizeBytes)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Строка разбивки docker: тип, размер и сколько можно освободить (prune). */
function DockerUsageRow({ d }: { d: DockerUsageEntry }) {
  return (
    <div
      className="flex items-center justify-between rounded-md bg-edge/40 px-2 py-1 text-xs"
      title={`${d.active} из ${d.total} активны`}
    >
      <span className="text-slate-300">{d.type}</span>
      <span className="flex items-center gap-2">
        <span className="text-slate-400">{formatBytes(d.sizeBytes)}</span>
        {d.reclaimableBytes > 0 && (
          <span className="text-amber-400" title="Можно освободить через docker prune">
            −{formatBytes(d.reclaimableBytes)}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Модалка с логами контейнера: снимок последних N строк (docker logs --tail).
 * Загружается по открытии и по кнопке «Обновить»; число строк выбирается.
 */
function ContainerLogsModal({
  serverId,
  name,
  onClose,
}: {
  serverId: string;
  name: string;
  onClose: () => void;
}) {
  const [tail, setTail] = useState(200);
  // Развёрнутый режим — окно логов почти на весь экран.
  const [expanded, setExpanded] = useState(false);
  const logs = useMutation({ mutationFn: () => api.containerLogs(serverId, name, tail) });

  // Грузим при открытии и при смене числа строк.
  useEffect(() => {
    logs.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail]);

  // Закрытие по Esc — удобно в развёрнутом режиме.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Свой оверлей (не общий Modal) — чтобы управлять размерами и разворачиванием.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={`card flex flex-col ${
          expanded ? "h-[92vh] w-[96vw] max-w-none" : "h-[75vh] w-full max-w-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="truncate text-lg font-semibold" title={name}>
            Логи: <span className="font-mono">{name}</span>
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="btn-ghost px-2 py-1 text-sm"
              title={expanded ? "Свернуть окно" : "Развернуть на весь экран"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "🗗 Свернуть" : "🗖 Развернуть"}
            </button>
            <button className="btn-ghost px-2 py-1" title="Закрыть (Esc)" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Строк:</span>
          {[100, 200, 500, 1000].map((n) => (
            <button
              key={n}
              className={`rounded px-2 py-0.5 ${
                tail === n ? "bg-indigo-600 text-white" : "bg-edge text-slate-300 hover:bg-edge/70"
              }`}
              onClick={() => setTail(n)}
            >
              {n}
            </button>
          ))}
          <button
            className="ml-auto btn-ghost px-2 py-0.5"
            disabled={logs.isPending}
            onClick={() => logs.mutate()}
          >
            {logs.isPending ? <Spinner /> : "Обновить"}
          </button>
        </div>

        {logs.isError && (
          <div className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(logs.error).message}
          </div>
        )}

        {/* Окно логов растёт под размер карточки (flex-1) и скроллится. */}
        <pre className="flex-1 overflow-auto whitespace-pre rounded-lg bg-ink p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {logs.isPending && !logs.data ? "Загрузка…" : logs.data?.logs ?? ""}
        </pre>
      </div>
    </div>
  );
}
