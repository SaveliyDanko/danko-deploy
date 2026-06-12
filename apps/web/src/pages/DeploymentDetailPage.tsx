import type { BackupRecord, RunKind } from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { EmptyState, Modal, Spinner, StatusBadge } from "../components/ui.js";
import { api } from "../lib/api.js";
import { openDeployLogDrawer } from "../lib/deployLogDrawer.js";
import { formatBytes, formatDate } from "../lib/format.js";
import { ArtifactChip } from "./ProjectDetailPage.js";

const kindLabels = {
  "docker-compose": "Docker Compose",
  systemd: "systemd-юнит",
  process: "Процесс / свои команды",
} as const;

/** Подпись и цвет ярлыка типа действия в истории. */
const runKindMeta: Record<RunKind, { label: string; cls: string }> = {
  deploy: { label: "Deploy", cls: "bg-indigo-500/15 text-indigo-300" },
  provision: { label: "Клон репо", cls: "bg-sky-500/15 text-sky-300" },
  undeploy: { label: "Undeploy", cls: "bg-amber-500/15 text-amber-300" },
  backup: { label: "Backup", cls: "bg-emerald-500/15 text-emerald-300" },
  restore: { label: "Restore", cls: "bg-fuchsia-500/15 text-fuchsia-300" },
};

function RunKindBadge({ kind }: { kind: RunKind }) {
  const meta = runKindMeta[kind] ?? runKindMeta.deploy;
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
  );
}

export function DeploymentDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmClearDeploys, setConfirmClearDeploys] = useState(false);
  const [confirmUndeploy, setConfirmUndeploy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({ queryKey: ["deployment", id], queryFn: () => api.getDeployment(id) });
  const deploys = useQuery({ queryKey: ["deploys", id], queryFn: () => api.deployHistory(id) });
  const projectId = detail.data?.project.id;
  const backups = useQuery({
    queryKey: ["backups", projectId],
    queryFn: () => api.backupHistory(projectId!),
    enabled: !!projectId,
  });

  const name = detail.data?.project.name ?? "проект";
  const openLog = (runId: string, title?: string) => {
    openDeployLogDrawer({
      runId,
      projectName: name,
      title,
      invalidateKeys: [
        ["deploys", id],
        ["deployment", id],
        ["deployments"],
        ...(projectId ? ([["backups", projectId]] as const) : []),
      ],
    });
  };

  const startDeploy = useMutation({
    mutationFn: () => api.startDeploy(id),
    onSuccess: (res) => openLog(res.runId),
  });
  const startUndeploy = useMutation({
    mutationFn: () => api.startUndeploy(id),
    onSuccess: (res) => {
      setConfirmUndeploy(false);
      openLog(res.runId, "Undeploy");
    },
  });
  const provision = useMutation({
    mutationFn: () => api.provisionDeployment(id),
    onSuccess: (res) => openLog(res.runId, "Клонирование репозитория"),
  });
  const clearDeploys = useMutation({
    mutationFn: () => api.clearDeployHistory(id),
    onSuccess: () => {
      setConfirmClearDeploys(false);
      void qc.invalidateQueries({ queryKey: ["deploys", id] });
      void qc.invalidateQueries({ queryKey: ["deployment", id] });
    },
  });
  const runBackup = useMutation({
    mutationFn: () => api.runBackup(id),
    onSuccess: (res) => openLog(res.runId, "Backup"),
  });
  const deployEnv = useMutation({ mutationFn: () => api.deployEnv(id) });
  const removeDeployment = useMutation({
    mutationFn: () => api.deleteDeployment(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["deployments"] });
      void navigate("/deployments");
    },
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.isError || !detail.data) return <EmptyState text="Деплой не найден." />;

  const { project, serverName, status, gitRevision, deployment } = detail.data;
  const hasBackup =
    !!project.config.backupArtifacts?.length || !!project.config.backupCommand;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/deployments" className="btn-ghost mb-1.5 inline-flex items-center gap-1 px-2.5 py-1 text-xs">
            <span aria-hidden>←</span> Все деплои
          </Link>
          <h1 className="text-xl font-semibold">
            {project.name} <span className="text-slate-500">→ {serverName}</span>
          </h1>
          <Link to={`/projects/${project.id}`} className="text-xs text-indigo-400 hover:underline">
            карточка проекта →
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {project.config.source && (
            <button
              className="btn-ghost"
              disabled={provision.isPending}
              title="Первичная загрузка кода: git clone репозитория в рабочую директорию. Делается один раз перед первым деплоем (workdir должен быть пуст)."
              onClick={() => provision.mutate()}
            >
              {provision.isPending ? <Spinner /> : "Клонировать репо"}
            </button>
          )}
          <button
            className="btn-ghost"
            disabled={runBackup.isPending || !hasBackup}
            title={!hasBackup ? "Команда бэкапа не задана в проекте" : ""}
            onClick={() => runBackup.mutate()}
          >
            {runBackup.isPending ? <Spinner /> : "Сделать бэкап"}
          </button>
          <button
            className="btn-primary"
            disabled={startDeploy.isPending}
            onClick={() => startDeploy.mutate()}
          >
            {startDeploy.isPending ? <Spinner /> : "Deploy"}
          </button>
          <button
            className="btn-ghost text-amber-300 hover:bg-amber-500/10"
            disabled={startUndeploy.isPending}
            onClick={() => setConfirmUndeploy(true)}
          >
            {startUndeploy.isPending ? <Spinner /> : "Undeploy"}
          </button>
          <button
            className="btn-ghost text-rose-400 hover:bg-rose-500/10"
            disabled={removeDeployment.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            {removeDeployment.isPending ? <Spinner /> : "Удалить"}
          </button>
        </div>
      </div>

      {/* Сводка */}
      <div className="card grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Статус">
          <StatusBadge status={status} />
        </Field>
        <Field label="Сервер">{serverName}</Field>
        <Field label="Способ раскатки">{kindLabels[project.kind]}</Field>
        <Field label="Git-ревизия">{gitRevision ?? "—"}</Field>
        <Field label="Рабочая директория">
          <span className="font-mono text-xs">{project.config.workdir}</span>
        </Field>
        <Field label="Последний деплой">
          {deployment.lastDeployAt ? (
            <span className="flex items-center gap-2">
              {formatDate(deployment.lastDeployAt)}
              {deployment.lastDeployStatus && (
                <StatusBadge status={deployment.lastDeployStatus} />
              )}
            </span>
          ) : (
            "—"
          )}
        </Field>
        {project.config.source && (
          <Field label="Источник">
            <span className="font-mono text-xs">{project.config.source.repoUrl}</span>
          </Field>
        )}
      </div>

      {/* .env проекта → записать на сервер этого деплоя */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Переменные окружения (.env)
        </h2>
        <div className="card flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-400">
            Шаблон .env задаётся в{" "}
            <Link to={`/projects/${project.id}`} className="text-indigo-400 hover:underline">
              карточке проекта
            </Link>
            . Запишет его в{" "}
            <code className="rounded bg-ink px-1">
              {project.config.workdir.replace(/\/+$/, "")}/.env
            </code>{" "}
            на сервере {serverName} (права 600).
          </span>
          <button
            className="btn-ghost"
            disabled={deployEnv.isPending}
            onClick={() => deployEnv.mutate()}
          >
            {deployEnv.isPending ? <Spinner /> : "Записать .env на сервер"}
          </button>
          {deployEnv.data?.ok && (
            <span className="text-xs text-emerald-400">✔ записан в {deployEnv.data.path}</span>
          )}
          {deployEnv.data && !deployEnv.data.ok && (
            <span className="text-xs text-rose-400">✖ {deployEnv.data.error}</span>
          )}
          {deployEnv.isError && (
            <span className="text-xs text-rose-400">{(deployEnv.error).message}</span>
          )}
        </div>
      </section>

      {/* История действий (deploy / раскатка / undeploy / backup) */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            История действий
          </h2>
          <button
            className="btn-ghost px-3 py-1 text-xs"
            disabled={clearDeploys.isPending || !deploys.data?.some((d) => d.status !== "running")}
            title="Удалить завершённые записи истории действий"
            onClick={() => setConfirmClearDeploys(true)}
          >
            {clearDeploys.isPending ? <Spinner /> : "Очистить лог"}
          </button>
        </div>
        {deploys.data?.length === 0 && <EmptyState text="Действий пока не было." />}
        <div className="space-y-2">
          {deploys.data?.map((d) => (
            <div key={d.id} className="card flex items-center justify-between py-3">
              <span className="flex items-center gap-3">
                <RunKindBadge kind={d.kind} />
                <span className="text-sm text-slate-300">{formatDate(d.startedAt)}</span>
              </span>
              <StatusBadge status={d.status} />
            </div>
          ))}
        </div>
      </section>

      {/* Бэкапы (история на проекте; восстановление — на сервер этого деплоя) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Бэкапы проекта
        </h2>
        {backups.data?.length === 0 && <EmptyState text="Бэкапов пока не было." />}
        <div className="space-y-2">
          {backups.data?.map((b) => (
            <BackupRow
              key={b.id}
              backup={b}
              deploymentId={id}
              targetLabel={`${project.name} → ${serverName}`}
              onDeleted={() => qc.invalidateQueries({ queryKey: ["backups", projectId] })}
              onRestoreStarted={(runId) => openLog(runId, "Restore")}
            />
          ))}
        </div>
      </section>

      {confirmUndeploy && (
        <Modal title="Undeploy" onClose={() => setConfirmUndeploy(false)}>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              Сервис будет остановлен на сервере {serverName}. Для Docker Compose выполнится{" "}
              <code className="rounded bg-ink px-1">docker compose down --remove-orphans</code>;
              данные volumes не удаляются.
            </div>
            <p className="text-sm text-slate-400">
              Код и файлы в рабочей директории останутся на месте. Вернуть сервис можно обычным Deploy.
            </p>
            {startUndeploy.isError && (
              <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
                {(startUndeploy.error).message}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                className="btn-ghost"
                disabled={startUndeploy.isPending}
                onClick={() => setConfirmUndeploy(false)}
              >
                Отмена
              </button>
              <button
                className="btn-danger"
                disabled={startUndeploy.isPending}
                onClick={() => startUndeploy.mutate()}
              >
                {startUndeploy.isPending ? <Spinner /> : "Undeploy"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmClearDeploys && (
        <Modal title="Очистить лог деплоев" onClose={() => setConfirmClearDeploys(false)}>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              Будут удалены завершённые записи истории деплоев этого деплоя. Активный деплой, если он
              сейчас идёт, останется нетронутым.
            </div>
            {clearDeploys.isError && (
              <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
                {(clearDeploys.error).message}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                className="btn-ghost"
                disabled={clearDeploys.isPending}
                onClick={() => setConfirmClearDeploys(false)}
              >
                Отмена
              </button>
              <button
                className="btn-danger"
                disabled={clearDeploys.isPending}
                onClick={() => clearDeploys.mutate()}
              >
                {clearDeploys.isPending ? <Spinner /> : "Очистить"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Удалить деплой?" onClose={() => setConfirmDelete(false)}>
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              Деплой <span className="font-semibold">{project.name} → {serverName}</span> будет удалён
              вместе с историей раскаток.
            </div>
            <p className="text-sm text-slate-400">
              Карточка проекта, его .env и файлы/контейнеры на сервере {serverName}{" "}
              <span className="font-medium text-slate-300">не затрагиваются</span>.
            </p>
            {removeDeployment.isError && (
              <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
                {(removeDeployment.error).message}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                className="btn-ghost"
                disabled={removeDeployment.isPending}
                onClick={() => setConfirmDelete(false)}
              >
                Отмена
              </button>
              <button
                className="btn-danger"
                disabled={removeDeployment.isPending}
                onClick={() => removeDeployment.mutate()}
              >
                {removeDeployment.isPending ? <Spinner /> : "Удалить деплой"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm text-slate-200">{children}</div>
    </div>
  );
}

/**
 * Строка истории бэкапов: артефакты (db, media, …) + «Восстановить» → модалка
 * выбора артефактов. Восстановление выполняется на сервер ЭТОГО деплоя.
 */
function BackupRow({
  backup: b,
  deploymentId,
  targetLabel,
  onDeleted,
  onRestoreStarted,
}: {
  backup: BackupRecord;
  deploymentId: string;
  targetLabel: string;
  onDeleted: () => void;
  onRestoreStarted: (runId: string) => void;
}) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const restorable = b.status === "success" && b.artifacts.length > 0;

  return (
    <div className="card py-3">
      <div className="flex items-start justify-between">
        <div className="text-sm">
          <div className="text-slate-300">{formatDate(b.startedAt)}</div>
          <div className="text-xs text-slate-500">
            {b.uploaded ? "загружен" : b.scheduled ? "по расписанию" : "вручную"}
            {b.status === "failed" && b.error ? ` · ${b.error}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {restorable && (
            <button
              className="btn-ghost px-3 py-1 text-xs"
              title="Восстановить выбранные артефакты на сервер этого деплоя"
              onClick={() => setRestoreOpen(true)}
            >
              Восстановить
            </button>
          )}
          <button
            className="btn-ghost px-3 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
            disabled={b.status === "running"}
            onClick={() => setDeleteOpen(true)}
          >
            Удалить
          </button>
          <StatusBadge status={b.status} />
        </div>
      </div>

      {b.artifacts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {b.artifacts.map((a) => (
            <ArtifactChip
              key={a.name}
              projectId={b.projectId}
              backupId={b.id}
              name={a.name}
              sizeBytes={a.sizeBytes}
              path={a.path}
              downloadable={b.status === "success"}
            />
          ))}
        </div>
      )}

      {restoreOpen && (
        <RestoreModal
          backup={b}
          deploymentId={deploymentId}
          targetLabel={targetLabel}
          onClose={() => setRestoreOpen(false)}
          onStarted={(runId) => {
            setRestoreOpen(false);
            onRestoreStarted(runId);
          }}
        />
      )}

      {deleteOpen && (
        <DeleteBackupModal
          backup={b}
          onClose={() => setDeleteOpen(false)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

function DeleteBackupModal({
  backup,
  onClose,
  onDeleted,
}: {
  backup: BackupRecord;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: () => api.deleteBackup(backup.projectId, backup.id),
    onSuccess: onDeleted,
  });

  return (
    <Modal title="Удалить бэкап?" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-300">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-100">
          Будет удалена запись из истории и локальные файлы артефактов на машине панели. Данные на
          сервере не затрагиваются.
        </div>
        <div className="space-y-1 text-xs text-slate-400">
          <div>Дата: {formatDate(backup.startedAt)}</div>
          <div>
            Артефакты:{" "}
            {backup.artifacts.length
              ? backup.artifacts.map((artifact) => artifact.name).join(", ")
              : "нет"}
          </div>
        </div>
        {remove.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(remove.error).message}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" disabled={remove.isPending} onClick={onClose}>
            Отмена
          </button>
          <button className="btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? <Spinner /> : "Удалить бэкап"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Модалка восстановления: выбор артефактов (чекбоксы) + «Все», подтверждение. */
function RestoreModal({
  backup: b,
  deploymentId,
  targetLabel,
  onClose,
  onStarted,
}: {
  backup: BackupRecord;
  deploymentId: string;
  targetLabel: string;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(b.artifacts.map((a) => a.name)),
  );
  const restore = useMutation({
    mutationFn: () => api.restoreBackup(deploymentId, b.id, Array.from(selected)),
    onSuccess: (res) => onStarted(res.runId),
  });

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const allSelected = selected.size === b.artifacts.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(b.artifacts.map((a) => a.name)));

  return (
    <Modal title={`Восстановление: ${targetLabel}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
          <div className="font-medium">Перед восстановлением</div>
          <div className="mt-1 text-xs leading-relaxed">
            Выбранные артефакты будут загружены на сервер{" "}
            <span className="font-semibold">{targetLabel}</span> и там выполнится их restore-команда.
            Текущие данные на этом сервере могут быть перезаписаны.
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Все артефакты
        </label>

        <div className="space-y-1 rounded-lg border border-edge p-2">
          {b.artifacts.map((a) => (
            <label key={a.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(a.name)}
                onChange={() => toggle(a.name)}
              />
              <span className="font-mono text-slate-200">{a.name}</span>
              <span className="text-xs text-slate-500">{formatBytes(a.sizeBytes)}</span>
            </label>
          ))}
        </div>

        {restore.isError && (
          <div className="text-xs text-rose-400">{(restore.error).message}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>
            Закрыть
          </button>
          <button
            className="btn-primary"
            disabled={restore.isPending || selected.size === 0}
            onClick={() => restore.mutate()}
          >
            {restore.isPending ? <Spinner /> : `Открыть лог restore (${selected.size})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
