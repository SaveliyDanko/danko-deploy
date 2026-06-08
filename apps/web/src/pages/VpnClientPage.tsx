import type {
  VpnClientExitInfo,
  VpnClientReadiness,
  VpnClientServer,
  VpnServiceCheck,
} from "@dankodeploy/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ConfirmModal, EmptyState, MeterBar, Spinner, StatusBadge } from "../components/ui.js";
import { api } from "../lib/api.js";
import { openDeployLogDrawer } from "../lib/deployLogDrawer.js";
import { formatDate } from "../lib/format.js";

function clientStatusLabel(status: string): string {
  const map: Record<string, string> = {
    installing: "включение…",
    active: "активен",
    syncing: "обновление…",
    error: "ошибка",
    removed: "выключен",
  };
  return map[status] ?? status;
}

/** Секция «VPN-клиент»: VPS гонит трафик через провайдера (sing-box). Заголовок даёт VpnPage. */
export function VpnClientSection() {
  const clients = useQuery({ queryKey: ["vpnClient"], queryFn: api.listVpnClients });
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });

  const [selectedServer, setSelectedServer] = useState("");
  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [locations, setLocations] = useState<VpnClientServer[] | null>(null);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [readiness, setReadiness] = useState<VpnClientReadiness | null>(null);
  const [ipResult, setIpResult] = useState<Record<string, VpnClientExitInfo>>({});
  const [serviceResult, setServiceResult] = useState<Record<string, VpnServiceCheck[]>>({});
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Сервер занят, если на нём уже есть невыключенный клиент.
  const busyServerIds = new Set(
    (clients.data ?? []).filter((c) => c.status !== "removed").map((c) => c.serverId),
  );

  const parse = useMutation({
    mutationFn: (url: string) => api.parseSubscription(url),
    onSuccess: (res) => {
      setLocations(res);
      setSelectedLabel(res[0]?.label ?? "");
    },
  });

  const checkReadiness = useMutation({
    mutationFn: (serverId: string) => api.vpnClientReadiness(serverId),
    onSuccess: (res) => setReadiness(res),
  });

  const install = useMutation({
    mutationFn: () =>
      api.installVpnClient({ serverId: selectedServer, subscriptionUrl, selectedLabel }),
    onSuccess: (res) => {
      const server = servers.data?.find((s) => s.id === selectedServer);
      openDeployLogDrawer({
        runId: res.runId,
        projectName: server?.name ?? "сервер",
        title: "Включение VPN-клиента",
        invalidateKeys: [["vpnClient"]],
      });
      setReadiness(null);
      setLocations(null);
      setSubscriptionUrl("");
      setSelectedServer("");
      setSelectedLabel("");
    },
  });

  const checkIp = useMutation({
    mutationFn: (id: string) => api.vpnClientExternalIp(id),
    onSuccess: (res, id) => setIpResult((prev) => ({ ...prev, [id]: res })),
  });

  const checkServices = useMutation({
    mutationFn: (id: string) => api.vpnClientServices(id),
    onSuccess: (res, id) => setServiceResult((prev) => ({ ...prev, [id]: res })),
  });

  const serverName = (serverId: string) =>
    servers.data?.find((s) => s.id === serverId)?.name ?? serverId;

  // Открыть live-лог фоновой операции карточки.
  const openCardLog = (id: string, runId: string, title: string) => {
    const client = clients.data?.find((c) => c.id === id);
    openDeployLogDrawer({
      runId,
      projectName: serverName(client?.serverId ?? "") || (client?.host ?? "сервер"),
      title,
      invalidateKeys: [["vpnClient"]],
    });
  };

  const disable = useMutation({
    mutationFn: (id: string) => api.disableVpnClient(id),
    onSuccess: (res, id) => {
      setConfirmDisableId(null);
      openCardLog(id, res.runId, "Выключение VPN-клиента");
    },
  });

  const enable = useMutation({
    mutationFn: (id: string) => api.enableVpnClient(id),
    onSuccess: (res, id) => openCardLog(id, res.runId, "Включение VPN-клиента"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeVpnClient(id),
    onSuccess: (res, id) => {
      setConfirmRemoveId(null);
      openCardLog(id, res.runId, "Удаление VPN-клиента");
    },
  });

  // Локации для смены: тянем по кнопке на карточке (ленивая загрузка по клиенту).
  const [cardLocations, setCardLocations] = useState<Record<string, VpnClientServer[]>>({});
  const loadLocations = useMutation({
    mutationFn: (id: string) => api.vpnClientLocations(id),
    onSuccess: (res, id) => setCardLocations((prev) => ({ ...prev, [id]: res })),
  });

  const changeLocation = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api.changeVpnClientLocation(id, label),
    onSuccess: (res, { id }) => openCardLog(id, res.runId, "Смена локации VPN"),
  });

  const sync = useMutation({
    mutationFn: (id: string) => api.syncVpnClient(id),
    onSuccess: (res, id) => openCardLog(id, res.runId, "Обновление подписки VPN"),
  });

  return (
    <div className="space-y-6">

      <div className="card space-y-4">
        <h2 className="text-lg font-semibold">Подключить сервер к VPN-провайдеру</h2>
        <p className="text-sm text-slate-400">
          Сервер пойдёт в интернет через VPN провайдера (sing-box, режим TUN). Вставьте
          subscription-ссылку из вашего VPN-кабинета (та же, что в Happ/Hiddify).
        </p>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
          ⚠️ Весь исходящий трафик сервера пойдёт через VPN. SSH-доступ панели исключается из
          туннеля автоматически (на уровне ядра), чтобы управление не оборвалось.
        </div>

        <div className="grid gap-3">
          <select
            className="input max-w-md"
            value={selectedServer}
            onChange={(e) => {
              setSelectedServer(e.target.value);
              setReadiness(null);
            }}
          >
            <option value="">— выберите сервер —</option>
            {servers.data?.map((s) => (
              <option key={s.id} value={s.id} disabled={busyServerIds.has(s.id)}>
                {s.name} ({s.host}){busyServerIds.has(s.id) ? " — VPN-клиент уже включён" : ""}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1 min-w-[280px]"
              type="url"
              placeholder="https://… subscription-ссылка"
              value={subscriptionUrl}
              onChange={(e) => {
                setSubscriptionUrl(e.target.value);
                setLocations(null);
              }}
            />
            <button
              className="btn-ghost"
              disabled={!subscriptionUrl || parse.isPending}
              onClick={() => parse.mutate(subscriptionUrl)}
            >
              {parse.isPending ? <Spinner /> : "Загрузить локации"}
            </button>
          </div>

          {parse.isError && (
            <div className="text-sm text-rose-400">{(parse.error).message}</div>
          )}

          {locations && (
            <select
              className="input max-w-md"
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
            >
              {locations.map((l) => (
                <option key={l.index} value={l.label}>
                  {l.label} ({l.host})
                </option>
              ))}
            </select>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost"
              disabled={!selectedServer || checkReadiness.isPending}
              onClick={() => checkReadiness.mutate(selectedServer)}
            >
              {checkReadiness.isPending ? <Spinner /> : "Проверить готовность"}
            </button>
            <button
              className="btn-primary"
              disabled={!selectedServer || !subscriptionUrl || !selectedLabel || install.isPending}
              onClick={() => install.mutate()}
            >
              {install.isPending ? <Spinner /> : "Включить VPN"}
            </button>
          </div>

          {install.isError && (
            <div className="text-sm text-rose-400">{(install.error).message}</div>
          )}
        </div>

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

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Подключённые серверы</h2>
        {clients.isLoading && <Spinner />}
        {clients.data?.length === 0 && (
          <EmptyState text="Пока нет VPN-клиентов. Подключите сервер к провайдеру выше." />
        )}
        <div className="grid gap-3">
          {clients.data?.map((c) => {
            const exit = ipResult[c.id];
            const services = serviceResult[c.id];
            return (
              <div key={c.id} className="card space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{serverName(c.serverId)}</span>
                      <StatusBadge
                        status={c.status === "active" ? "success" : c.status === "error" ? "failed" : "running"}
                      />
                      <span className="text-xs text-slate-500">{clientStatusLabel(c.status)}</span>
                    </div>
                    <div className="text-sm text-slate-400">локация: {c.selectedLabel}</div>
                    {/* Проверка IP: показываем «было host → стало IP (страна, провайдер)». */}
                    {exit ? (
                      <div className="text-xs">
                        <span className="text-slate-500">IP сервера {exit.serverHost} → выход </span>
                        <span className={exit.throughVpn ? "text-emerald-400" : "text-amber-400"}>
                          {exit.externalIp ?? "—"}
                          {exit.country ? ` · ${exit.country}` : ""}
                          {exit.org ? ` · ${exit.org}` : ""}
                        </span>
                        <span className="text-slate-500">
                          {" "}
                          {exit.throughVpn
                            ? "— трафик идёт через VPN ✔"
                            : "— совпадает с host, туннель НЕ активен ✖"}
                        </span>
                      </div>
                    ) : (
                      c.externalIp && (
                        <div className="text-xs text-slate-500">
                          внешний IP: {c.externalIp} (нажмите «Проверить IP» для деталей)
                        </div>
                      )
                    )}
                    {/* Проверка популярных сервисов через VPN. */}
                    {services && (
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        {services.map((s) => (
                          <span
                            key={s.name}
                            className={s.reachable ? "text-emerald-400" : "text-rose-400"}
                            title={s.detail}
                          >
                            {s.reachable ? "✔" : "✖"} {s.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.lastSyncedAt && (
                      <div className="text-xs text-slate-500">
                        обновлено {formatDate(c.lastSyncedAt)}
                      </div>
                    )}
                    {c.lastError && <div className="text-xs text-rose-400">{c.lastError}</div>}
                  </div>
                  <div className="flex flex-col items-stretch gap-1">
                    {c.status === "active" && (
                      <>
                        <button
                          className="btn-ghost text-xs"
                          disabled={checkIp.isPending}
                          onClick={() => checkIp.mutate(c.id)}
                        >
                          {checkIp.isPending && checkIp.variables === c.id ? <Spinner /> : "Проверить IP"}
                        </button>
                        <button
                          className="btn-ghost text-xs"
                          disabled={checkServices.isPending}
                          onClick={() => checkServices.mutate(c.id)}
                        >
                          {checkServices.isPending && checkServices.variables === c.id ? (
                            <Spinner />
                          ) : (
                            "Проверить сервисы"
                          )}
                        </button>
                        <button
                          className="btn-ghost text-xs"
                          disabled={sync.isPending}
                          onClick={() => sync.mutate(c.id)}
                          title="Перетянуть подписку и перезапустить sing-box"
                        >
                          Обновить
                        </button>
                        <button
                          className="btn-ghost text-xs text-rose-400"
                          disabled={disable.isPending}
                          onClick={() => setConfirmDisableId(c.id)}
                        >
                          Выключить
                        </button>
                      </>
                    )}
                    {(c.status === "removed" || c.status === "error") && (
                      <>
                        <button
                          className="btn-primary text-xs"
                          disabled={enable.isPending}
                          onClick={() => enable.mutate(c.id)}
                        >
                          Включить
                        </button>
                        <button
                          className="btn-ghost text-xs text-rose-400"
                          disabled={remove.isPending}
                          onClick={() => setConfirmRemoveId(c.id)}
                        >
                          Удалить
                        </button>
                      </>
                    )}
                    {(c.status === "installing" || c.status === "syncing") && (
                      <span className="text-xs text-slate-500">операция выполняется…</span>
                    )}
                  </div>
                </div>

                {/* Смена локации доступна только у активного клиента. */}
                {c.status === "active" && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-2">
                    {!cardLocations[c.id] ? (
                      <button
                        className="btn-ghost text-xs"
                        disabled={loadLocations.isPending}
                        onClick={() => loadLocations.mutate(c.id)}
                      >
                        {loadLocations.isPending ? <Spinner /> : "Сменить локацию"}
                      </button>
                    ) : (
                      <>
                        <select
                          className="input text-xs"
                          defaultValue={c.selectedLabel}
                          onChange={(e) => {
                            const label = e.target.value;
                            if (label && label !== c.selectedLabel) {
                              changeLocation.mutate({ id: c.id, label });
                            }
                          }}
                        >
                          {cardLocations[c.id]!.map((l) => (
                            <option key={l.index} value={l.label}>
                              {l.label} ({l.host})
                            </option>
                          ))}
                        </select>
                        {changeLocation.isPending && <Spinner />}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {confirmDisableId && (
        <ConfirmModal
          title="Выключить VPN?"
          confirmLabel="Выключить"
          pending={disable.isPending}
          error={disable.isError ? disable.error.message : null}
          onConfirm={() => disable.mutate(confirmDisableId)}
          onClose={() => setConfirmDisableId(null)}
        >
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
            VPN на сервере{" "}
            <span className="font-semibold">
              {serverName(clients.data?.find((c) => c.id === confirmDisableId)?.serverId ?? "")}
            </span>{" "}
            будет выключен: sing-box остановлен, kernel-страховка снята. Трафик сервера снова пойдёт
            напрямую (без VPN).
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Конфигурация сохранится — VPN можно включить снова кнопкой «Включить».
          </p>
        </ConfirmModal>
      )}

      {confirmRemoveId && (
        <ConfirmModal
          title="Удалить VPN-клиент?"
          confirmLabel="Удалить"
          pending={remove.isPending}
          error={remove.isError ? remove.error.message : null}
          onConfirm={() => remove.mutate(confirmRemoveId)}
          onClose={() => setConfirmRemoveId(null)}
        >
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-100">
            VPN-клиент будет полностью снят с сервера{" "}
            <span className="font-semibold">
              {serverName(clients.data?.find((c) => c.id === confirmRemoveId)?.serverId ?? "")}
            </span>
            : sing-box удалён, kernel-страховка снята, запись стёрта.
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Чтобы вернуть VPN, его придётся настроить заново (subscription-ссылка не сохраняется).
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
