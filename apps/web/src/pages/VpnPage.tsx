import type { VpnReadiness } from "@dankodeploy/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState, MeterBar, Spinner, StatusBadge } from "../components/ui.js";
import { api } from "../lib/api.js";
import { openDeployLogDrawer } from "../lib/deployLogDrawer.js";
import { formatDate } from "../lib/format.js";

/** Подпись статуса VPN-инсталляции. */
function vpnStatusLabel(status: string): string {
  const map: Record<string, string> = {
    installing: "раскатка…",
    active: "активен",
    error: "ошибка",
    removed: "удалён",
  };
  return map[status] ?? status;
}

export function VpnPage() {
  const installations = useQuery({ queryKey: ["vpn"], queryFn: api.listVpn });
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });

  const [selectedServer, setSelectedServer] = useState("");
  const [readiness, setReadiness] = useState<VpnReadiness | null>(null);

  // Сервер можно выбрать только без уже активной/раскатываемой Outline-инсталляции.
  const busyServerIds = new Set(
    (installations.data ?? [])
      .filter((v) => v.status !== "removed")
      .map((v) => v.serverId),
  );

  const checkReadiness = useMutation({
    mutationFn: (serverId: string) => api.vpnReadiness(serverId),
    onSuccess: (res) => setReadiness(res),
  });

  const install = useMutation({
    mutationFn: (serverId: string) => api.installVpn({ serverId, kind: "outline" }),
    onSuccess: (res, serverId) => {
      const server = servers.data?.find((s) => s.id === serverId);
      openDeployLogDrawer({
        runId: res.runId,
        projectName: server?.name ?? "сервер",
        title: "Раскатка Outline VPN",
        invalidateKeys: [["vpn"]],
      });
      setReadiness(null);
      setSelectedServer("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeVpn(id),
    onSuccess: (res, id) => {
      const inst = installations.data?.find((v) => v.id === id);
      openDeployLogDrawer({
        runId: res.runId,
        projectName: inst?.host ?? "сервер",
        title: "Удаление VPN",
        invalidateKeys: [["vpn"]],
      });
    },
  });

  const serverName = (serverId: string) =>
    servers.data?.find((s) => s.id === serverId)?.name ?? serverId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">VPN</h1>
      </div>

      {/* --- Раскатка на сервер --- */}
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold">Развернуть VPN (Outline / Shadowsocks)</h2>
        <p className="text-sm text-slate-400">
          Проверьте готовность сервера и разверните Outline Server. Установка идёт по SSH —
          скрипт сам поставит Docker и поднимет контейнер.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input max-w-xs"
            value={selectedServer}
            onChange={(e) => {
              setSelectedServer(e.target.value);
              setReadiness(null);
            }}
          >
            <option value="">— выберите сервер —</option>
            {servers.data?.map((s) => (
              <option key={s.id} value={s.id} disabled={busyServerIds.has(s.id)}>
                {s.name} ({s.host}){busyServerIds.has(s.id) ? " — VPN уже развёрнут" : ""}
              </option>
            ))}
          </select>

          <button
            className="btn-ghost"
            disabled={!selectedServer || checkReadiness.isPending}
            onClick={() => checkReadiness.mutate(selectedServer)}
          >
            {checkReadiness.isPending ? <Spinner /> : "Проверить готовность"}
          </button>

          <button
            className="btn-primary"
            disabled={!selectedServer || install.isPending}
            onClick={() => install.mutate(selectedServer)}
          >
            {install.isPending ? <Spinner /> : "Развернуть VPN"}
          </button>
        </div>

        {checkReadiness.isError && (
          <div className="text-sm text-rose-400">
            {(checkReadiness.error).message}
          </div>
        )}
        {install.isError && (
          <div className="text-sm text-rose-400">{(install.error).message}</div>
        )}

        {/* --- Результат readiness-проверки --- */}
        {readiness && (
          <div className="space-y-4 rounded-lg border border-edge p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">Готовность сервера:</span>
              <StatusBadge status={readiness.ok ? "success" : "failed"} />
            </div>

            <ul className="space-y-1 text-sm">
              {readiness.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2">
                  <span className={c.ok ? "text-emerald-400" : "text-rose-400"}>
                    {c.ok ? "✔" : "✖"}
                  </span>
                  <span>
                    <span className="text-slate-200">{c.label}</span>
                    {c.detail && <span className="text-slate-500"> — {c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>

            {readiness.metrics && (
              <div className="grid gap-3 sm:grid-cols-3">
                {readiness.metrics.cpuPercent != null && (
                  <MeterBar percent={readiness.metrics.cpuPercent} label="CPU" />
                )}
                {readiness.metrics.memTotalMb != null && readiness.metrics.memUsedMb != null && (
                  <MeterBar
                    percent={(readiness.metrics.memUsedMb / readiness.metrics.memTotalMb) * 100}
                    label={`RAM (${readiness.metrics.memUsedMb}/${readiness.metrics.memTotalMb} МБ)`}
                  />
                )}
                {readiness.metrics.disks[0] && (
                  <MeterBar
                    percent={readiness.metrics.disks[0].usePercent}
                    label={`Диск ${readiness.metrics.disks[0].mount}`}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- Список развёрнутых VPN --- */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Развёрнутые VPN</h2>
        {installations.isLoading && <Spinner />}
        {installations.data?.length === 0 && (
          <EmptyState text="Пока нет развёрнутых VPN. Выберите сервер выше и разверните Outline." />
        )}
        <div className="grid gap-3">
          {installations.data?.map((v) => (
            <div key={v.id} className="card flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{serverName(v.serverId)}</span>
                  <StatusBadge
                    status={v.status === "active" ? "success" : v.status === "error" ? "failed" : "running"}
                  />
                  <span className="text-xs text-slate-500">{vpnStatusLabel(v.status)}</span>
                </div>
                <div className="text-sm text-slate-400">
                  {v.kind} · {v.host}
                  {v.apiPort ? `:${v.apiPort}` : ""}
                  {v.managed ? " · управляется" : ""}
                </div>
                {v.lastError && <div className="text-xs text-rose-400">{v.lastError}</div>}
                <div className="text-xs text-slate-500">развёрнут {formatDate(v.createdAt)}</div>
              </div>
              <button
                className="btn-ghost text-rose-400"
                disabled={remove.isPending || v.status === "installing"}
                onClick={() => {
                  if (confirm(`Удалить VPN с сервера «${serverName(v.serverId)}»?`)) {
                    remove.mutate(v.id);
                  }
                }}
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
