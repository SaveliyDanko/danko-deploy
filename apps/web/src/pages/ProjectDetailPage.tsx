import type { BackupRecord, DeploymentPublic, ProjectPublic, ServerPublic } from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ConfirmModal, EmptyState, Modal, Spinner, StatusBadge } from "../components/ui.js";
import { api } from "../lib/api.js";
import { openDeployLogDrawer } from "../lib/deployLogDrawer.js";
import { formatBytes, formatDate } from "../lib/format.js";
import { ProjectFormModal } from "./ProjectsPage.js";

const kindLabels = {
  "docker-compose": "Docker Compose",
  systemd: "systemd-юнит",
  process: "Процесс / свои команды",
} as const;

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });
  const deployments = useQuery({
    queryKey: ["deployments", "by-project", id],
    queryFn: () => api.listDeploymentsByProject(id),
  });
  const backups = useQuery({ queryKey: ["backups", id], queryFn: () => api.backupHistory(id) });

  const removeProject = useMutation({
    mutationFn: () => api.deleteProject(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void navigate("/projects");
    },
  });

  if (project.isLoading) return <Spinner />;
  if (project.isError || !project.data) return <EmptyState text="Проект не найден." />;

  const p = project.data;
  const hasBackup = !!p.config.backupArtifacts?.length || !!p.config.backupCommand;
  const openLog = (runId: string, title: string) => {
    openDeployLogDrawer({
      runId,
      projectName: p.name,
      title,
      invalidateKeys: [["backups", id], ["project", id], ["projects"]],
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/projects" className="btn-ghost mb-1.5 inline-flex items-center gap-1 px-2.5 py-1 text-xs">
            <span aria-hidden>←</span> Все проекты
          </Link>
          <h1 className="text-xl font-semibold">{p.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            Изменить
          </button>
          <button
            className="btn-ghost text-rose-400 hover:bg-rose-500/10"
            disabled={removeProject.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            {removeProject.isPending ? <Spinner /> : "Удалить"}
          </button>
        </div>
      </div>

      {/* Сводка карточки (без сервера/статуса — это уровень деплоя) */}
      <div className="card grid grid-cols-2 gap-4 md:grid-cols-3">
        <Field label="Способ раскатки">{kindLabels[p.kind]}</Field>
        <Field label="Рабочая директория">
          <span className="font-mono text-xs">{p.config.workdir}</span>
        </Field>
        <Field label="Авто-бэкап">{p.config.backupCron ?? "выкл"}</Field>
      </div>
      {p.description && <div className="card text-sm text-slate-300">{p.description}</div>}

      {/* Деплои проекта (создание — во вкладке «Деплои») */}
      <DeploymentsForProject
        deployments={deployments.data}
        servers={servers.data}
        loading={deployments.isLoading}
      />

      {/* Метаинформация проекта */}
      <ProjectMetaSection project={p} />

      {/* Переменные окружения (.env) — шаблон проекта */}
      <EnvSection projectId={id} workdir={p.config.workdir} />

      {/* История бэкапов (общая по всем деплоям; восстановление — на выбранный деплой) */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Бэкапы</h2>
          <div className="flex items-center gap-2">
            <button
              className="btn-primary px-3 py-1 text-xs"
              disabled={!deployments.data?.length || !hasBackup}
              title={
                !deployments.data?.length
                  ? "Сначала создайте деплой проекта"
                  : !hasBackup
                    ? "Бэкап не настроен в проекте"
                    : ""
              }
              onClick={() => setBackupOpen(true)}
            >
              Сделать бэкап
            </button>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              title="Загрузить файл бэкапа с компьютера и привязать его к артефакту проекта"
              onClick={() => setUploadOpen(true)}
            >
              Загрузить бэкап
            </button>
          </div>
        </div>
        {backups.data?.length === 0 && <EmptyState text="Бэкапов пока не было." />}
        <div className="space-y-2">
          {backups.data?.map((b) => (
            <ProjectBackupRow
              key={b.id}
              backup={b}
              deployments={deployments.data ?? []}
              servers={servers.data ?? []}
              projectName={p.name}
              onChanged={() => qc.invalidateQueries({ queryKey: ["backups", id] })}
              onRestoreStarted={(runId) => openLog(runId, "Restore")}
            />
          ))}
        </div>
      </section>

      {backupOpen && (
        <RunProjectBackupModal
          projectName={p.name}
          deployments={deployments.data ?? []}
          servers={servers.data ?? []}
          onClose={() => setBackupOpen(false)}
          onDone={(runId) => {
            setBackupOpen(false);
            openLog(runId, "Backup");
            void qc.invalidateQueries({ queryKey: ["backups", id] });
          }}
        />
      )}

      {uploadOpen && (
        <UploadProjectBackupModal
          projectId={id}
          project={p}
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ["backups", id] });
          }}
        />
      )}

      {editing && servers.data && (
        <ProjectFormModal
          project={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void qc.invalidateQueries({ queryKey: ["project", id] });
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Удалить проект?"
          confirmLabel="Удалить проект"
          pending={removeProject.isPending}
          error={removeProject.isError ? removeProject.error.message : null}
          onConfirm={() => removeProject.mutate()}
          onClose={() => setConfirmDelete(false)}
        >
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-100">
            Проект <span className="font-semibold">{p.name}</span> будет удалён из панели вместе со
            всеми деплоями, историей и сохранённым <code className="rounded bg-ink px-1">.env</code>.
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Файлы, контейнеры и данные на серверах не затрагиваются — удаляется только конфигурация в
            DankoDeploy.
          </p>
        </ConfirmModal>
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

function RunProjectBackupModal({
  projectName,
  deployments,
  servers,
  onClose,
  onDone,
}: {
  projectName: string;
  deployments: DeploymentPublic[];
  servers: ServerPublic[];
  onClose: () => void;
  onDone: (runId: string) => void;
}) {
  const [deploymentId, setDeploymentId] = useState(deployments[0]?.id ?? "");
  const runBackup = useMutation({
    mutationFn: () => api.runBackup(deploymentId),
    onSuccess: (res) => onDone(res.runId),
  });

  const serverName = (serverId: string) => servers.find((s) => s.id === serverId)?.name ?? serverId;

  return (
    <Modal title="Сделать бэкап" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-300">
        <p>
          Выберите деплой, с сервера которого нужно снять бэкап проекта{" "}
          <span className="font-medium text-slate-100">{projectName}</span>.
        </p>
        <div>
          <label className="label">Деплой</label>
          <select
            className="input"
            value={deploymentId}
            onChange={(e) => setDeploymentId(e.target.value)}
          >
            {deployments.map((d) => (
              <option key={d.id} value={d.id}>
                {projectName} → {serverName(d.serverId)}
              </option>
            ))}
          </select>
        </div>
        {runBackup.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(runBackup.error).message}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" disabled={runBackup.isPending} onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-primary"
            disabled={runBackup.isPending || !deploymentId}
            onClick={() => runBackup.mutate()}
          >
            {runBackup.isPending ? <Spinner /> : "Сделать бэкап"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UploadProjectBackupModal({
  projectId,
  project,
  onClose,
  onDone,
}: {
  projectId: string;
  project: ProjectPublic;
  onClose: () => void;
  onDone: () => void;
}) {
  const configuredArtifacts =
    project.config.backupArtifacts?.map((artifact) => artifact.name) ??
    (project.config.backupCommand ? ["default"] : []);
  const artifactOptions = configuredArtifacts.length > 0 ? configuredArtifacts : ["default"];
  const [artifactName, setArtifactName] = useState(artifactOptions[0] ?? "default");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedBackup, setUploadedBackup] = useState<BackupRecord | null>(null);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadLockRef = useRef(false);
  const upload = useMutation({
    mutationFn: (input: { file: File; artifactName: string; fileKey: string }) =>
      api.uploadBackup(projectId, input.file, input.artifactName),
    onSuccess: (backup, input) => {
      setUploadedBackup(backup);
      setUploadedFileKey(input.fileKey);
      onDone();
    },
    onSettled: () => {
      uploadLockRef.current = false;
    },
  });
  const uploadedArtifact = uploadedBackup?.artifacts[0];
  const selectedFileKey = file ? `${artifactName}:${file.name}:${file.size}:${file.lastModified}` : null;
  const alreadyUploaded = !!selectedFileKey && selectedFileKey === uploadedFileKey;

  const changeFile = (nextFile: File | null) => {
    setFile(nextFile);
    setUploadedBackup(null);
    setUploadedFileKey(null);
    upload.reset();
  };

  const changeArtifact = (name: string) => {
    setArtifactName(name);
    setUploadedBackup(null);
    setUploadedFileKey(null);
    upload.reset();
  };

  const startUpload = () => {
    if (!file || !artifactName || !selectedFileKey || alreadyUploaded || uploadLockRef.current) {
      return;
    }

    uploadLockRef.current = true;
    upload.mutate({ file, artifactName, fileKey: selectedFileKey });
  };

  return (
    <Modal title="Загрузить бэкап" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-300">
        <p>
          Выберите файл и артефакт, к которому он относится. Restore-команда берётся из настроек
          проекта по имени артефакта.
        </p>
        <div>
          <label className="label">Артефакт</label>
          <select
            className="input"
            value={artifactName}
            disabled={upload.isPending}
            onChange={(e) => changeArtifact(e.target.value)}
          >
            {artifactOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {configuredArtifacts.length === 0 && (
            <p className="mt-1 text-xs text-amber-400">
              В проекте пока не настроены артефакты. Файл сохранится как legacy-артефакт default.
            </p>
          )}
        </div>
        <div>
          <label className="label">Файл бэкапа</label>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            onChange={(e) => changeFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-edge bg-ink/40 px-3 py-3 text-left transition hover:border-indigo-500/50 hover:bg-indigo-500/5"
            disabled={upload.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <span>
              <span className="block text-sm text-slate-200">
                {file ? file.name : "Выбрать файл бэкапа"}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {file ? formatBytes(file.size) : "Файл будет сохранён в историю бэкапов проекта"}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-edge px-3 py-1 text-xs text-slate-300">
              Browse
            </span>
          </button>
        </div>
        {uploadedBackup && uploadedArtifact && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            <div className="font-medium text-emerald-100">Бэкап загружен</div>
            <div className="mt-1 text-emerald-200/80">
              Артефакт: <span className="font-mono">{uploadedArtifact.name}</span> · размер:{" "}
              {formatBytes(uploadedArtifact.sizeBytes)}
            </div>
          </div>
        )}
        {upload.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(upload.error).message}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" disabled={upload.isPending} onClick={onClose}>
            {uploadedBackup ? "Закрыть" : "Отмена"}
          </button>
          <button
            className="btn-primary"
            disabled={upload.isPending || !file || !artifactName || alreadyUploaded}
            onClick={startUpload}
          >
            {upload.isPending ? <Spinner /> : alreadyUploaded ? "Уже загружен" : "Загрузить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Чип артефакта бэкапа. Для успешного бэкапа — кликабельная кнопка скачивания
 * файла на ПК (⬇), иначе просто метка. Ошибку скачивания показывает рядом.
 */
export function ArtifactChip({
  projectId,
  backupId,
  name,
  sizeBytes,
  path,
  downloadable,
}: {
  projectId: string;
  backupId: string;
  name: string;
  sizeBytes: number | null;
  path: string;
  downloadable: boolean;
}) {
  const download = useMutation({
    mutationFn: () => api.downloadBackupArtifact(projectId, backupId, name),
  });

  const label = `${name} · ${formatBytes(sizeBytes)}`;

  if (!downloadable) {
    return (
      <span
        className="rounded bg-edge/50 px-2 py-0.5 font-mono text-[11px] text-slate-300"
        title={path}
      >
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        className="flex items-center gap-1 rounded bg-edge/50 px-2 py-0.5 font-mono text-[11px] text-slate-300 transition hover:bg-indigo-500/20 hover:text-indigo-200"
        title={`Скачать «${name}» на ПК`}
        disabled={download.isPending}
        onClick={() => download.mutate()}
      >
        {download.isPending ? <Spinner /> : <span aria-hidden>⬇</span>} {label}
      </button>
      {download.isError && (
        <span className="text-[11px] text-rose-400" title={(download.error).message}>
          ✖
        </span>
      )}
    </span>
  );
}

function ProjectBackupRow({
  backup: b,
  deployments,
  servers,
  projectName,
  onChanged,
  onRestoreStarted,
}: {
  backup: BackupRecord;
  deployments: DeploymentPublic[];
  servers: ServerPublic[];
  projectName: string;
  onChanged: () => void;
  onRestoreStarted: (runId: string) => void;
}) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const restorable = b.status === "success" && b.artifacts.length > 0 && deployments.length > 0;

  return (
    <div className="card py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <div className="text-slate-300">{formatDate(b.startedAt)}</div>
          <div className="text-xs text-slate-500">
            {b.uploaded ? "загружен" : b.scheduled ? "по расписанию" : "вручную"}
            {b.status === "failed" && b.error ? ` · ${b.error}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost px-3 py-1 text-xs"
            disabled={!restorable}
            title={
              !deployments.length
                ? "Сначала создайте деплой проекта"
                : b.status !== "success"
                  ? "Восстановить можно только успешный бэкап"
                  : !b.artifacts.length
                    ? "У бэкапа нет артефактов"
                    : ""
            }
            onClick={() => setRestoreOpen(true)}
          >
            Восстановить
          </button>
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
        <RestoreProjectBackupModal
          backup={b}
          deployments={deployments}
          servers={servers}
          projectName={projectName}
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
          onDeleted={onChanged}
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

function RestoreProjectBackupModal({
  backup: b,
  deployments,
  servers,
  projectName,
  onClose,
  onStarted,
}: {
  backup: BackupRecord;
  deployments: DeploymentPublic[];
  servers: ServerPublic[];
  projectName: string;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const [deploymentId, setDeploymentId] = useState(deployments[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(b.artifacts.map((a) => a.name)),
  );
  const restore = useMutation({
    mutationFn: () => api.restoreBackup(deploymentId, b.id, Array.from(selected)),
    onSuccess: (res) => onStarted(res.runId),
  });

  const serverName = (serverId: string) => servers.find((s) => s.id === serverId)?.name ?? serverId;
  const selectedDeployment = deployments.find((d) => d.id === deploymentId);
  const targetLabel = selectedDeployment
    ? `${projectName} → ${serverName(selectedDeployment.serverId)}`
    : "—";
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
    <Modal title="Восстановить бэкап" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-300">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
          <div className="font-medium">Перед восстановлением</div>
          <div className="mt-1 text-xs leading-relaxed">
            Выбранные артефакты будут загружены на сервер{" "}
            <span className="font-semibold">{targetLabel}</span> и там выполнится их restore-команда.
            Текущие данные на этом сервере могут быть перезаписаны.
          </div>
        </div>
        <div>
          <label className="label">Куда восстановить</label>
          <select
            className="input"
            value={deploymentId}
            onChange={(e) => setDeploymentId(e.target.value)}
          >
            {deployments.map((d) => (
              <option key={d.id} value={d.id}>
                {projectName} → {serverName(d.serverId)}
              </option>
            ))}
          </select>
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
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(restore.error).message}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" disabled={restore.isPending} onClick={onClose}>
            Закрыть
          </button>
          <button
            className="btn-danger"
            disabled={restore.isPending || !deploymentId || selected.size === 0}
            onClick={() => restore.mutate()}
          >
            {restore.isPending ? <Spinner /> : `Открыть лог restore (${selected.size})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Список деплоев проекта (проект×сервер). Создание деплоя — во вкладке «Деплои». */
function DeploymentsForProject({
  deployments,
  servers,
  loading,
}: {
  deployments: DeploymentPublic[] | undefined;
  servers: ServerPublic[] | undefined;
  loading: boolean;
}) {
  const serverName = (sid: string) => servers?.find((s) => s.id === sid)?.name ?? sid;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Деплои проекта
      </h2>
      {loading ? (
        <Spinner />
      ) : !deployments?.length ? (
        <EmptyState text="Проект ещё не развёрнут. Создайте деплой во вкладке «Деплои»." />
      ) : (
        <div className="space-y-2">
          {deployments.map((d) => (
            <Link
              key={d.id}
              to={`/deployments/${d.id}`}
              className="card flex items-center justify-between py-3 hover:border-indigo-500/40"
            >
              <span className="text-sm text-slate-200">→ {serverName(d.serverId)}</span>
              <span className="flex items-center gap-2">
                {d.lastDeployAt && (
                  <span className="text-xs text-slate-500">{formatDate(d.lastDeployAt)}</span>
                )}
                {d.lastDeployStatus ? (
                  <StatusBadge status={d.lastDeployStatus} />
                ) : (
                  <span className="text-xs text-slate-500">нет раскаток</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Доменное имя из URL ссылки: хост без www (например "litiysew.ru").
 * Толерантно к ссылкам без протокола; при неудаче парсинга возвращает исходную строку.
 */
function linkHost(url: string): string {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    return u.host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Карточки метаинформации проекта: репозиторий, ссылки, порты, контейнеры, env,
 * чек-лист, заметки. Чисто справочные — помогают быстро сориентироваться перед раскаткой.
 */
function ProjectMetaSection({ project }: { project: ProjectPublic }) {
  const meta = project.config.meta;
  const source = project.config.source;
  const hasMeta =
    !!source ||
    !!(
      meta &&
      (meta.ports?.length ||
        meta.containers?.length ||
        meta.envVars?.length ||
        meta.checklist?.length ||
        meta.links?.length ||
        meta.notes)
    );
  if (!hasMeta) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">О проекте</h2>

      {/* Репозиторий + ссылки */}
      {(source || meta?.links?.length) && (
        <div className="card space-y-2 text-sm">
          {source && (
            <div>
              <span className="text-slate-500">Репозиторий: </span>
              <span className="font-mono text-xs text-slate-200">{source.repoUrl}</span>
              {source.branch && <span className="text-xs text-slate-500"> · {source.branch}</span>}
            </div>
          )}
          {meta?.links?.length ? (
            <div className="flex flex-wrap gap-2">
              {meta.links.map((l, i) => {
                const host = linkHost(l.url);
                // С меткой показываем и метку, и само доменное имя; без метки — только домен/URL.
                const showHost = !!l.label && !!host && host !== l.label;
                return (
                  <a
                    key={i}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    title={l.url}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-200 transition hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-white"
                  >
                    <span aria-hidden>🔗</span>
                    {l.label || host || l.url}
                    {showHost && (
                      <span className="font-mono text-xs font-normal text-indigo-300/70">
                        {host}
                      </span>
                    )}
                    <span aria-hidden className="text-xs opacity-70">
                      ↗
                    </span>
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {meta?.ports?.length ? (
          <MetaCard title="Порты">
            {meta.ports.map((p, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-mono font-semibold text-slate-200">{p.port}</span>
                {p.description && <span className="text-slate-400">{p.description}</span>}
              </div>
            ))}
          </MetaCard>
        ) : null}

        {meta?.containers?.length ? (
          <MetaCard title="Контейнеры">
            {meta.containers.map((c, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-mono text-slate-200">{c.name}</span>
                {c.note && <span className="text-slate-400">{c.note}</span>}
              </div>
            ))}
          </MetaCard>
        ) : null}

        {meta?.envVars?.length ? (
          <MetaCard title="Env-переменные">
            {meta.envVars.map((e, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-mono text-slate-200">{e.key}</span>
                {e.note && <span className="text-slate-400">{e.note}</span>}
              </div>
            ))}
          </MetaCard>
        ) : null}

        {meta?.checklist?.length ? (
          <MetaCard title="Чек-лист перед раскаткой">
            {meta.checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={c.done ? "text-emerald-400" : "text-slate-500"}>
                  {c.done ? "✔" : "○"}
                </span>
                <span className={c.done ? "text-slate-400 line-through" : "text-slate-200"}>
                  {c.text}
                </span>
              </div>
            ))}
          </MetaCard>
        ) : null}
      </div>

      {meta?.notes && (
        <div className="card whitespace-pre-wrap text-sm text-slate-300">{meta.notes}</div>
      )}
    </section>
  );
}

function MetaCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-1.5">
      <div className="label mb-1">{title}</div>
      {children}
    </div>
  );
}

/**
 * Редактор .env проекта (шаблон). Контент хранится зашифрованным в панели; запись
 * на сервер выполняется со страницы конкретного деплоя (там известен сервер).
 */
function EnvSection({ projectId, workdir }: { projectId: string; workdir: string }) {
  const qc = useQueryClient();
  const env = useQuery({ queryKey: ["env", projectId], queryFn: () => api.getEnv(projectId) });

  const [draft, setDraft] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Блок свёрнут по умолчанию — на странице проекта он занимает много места.
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Текущее значение поля: черновик пользователя или загруженное из БД.
  const value = draft ?? env.data?.content ?? "";
  const dirty = draft !== null && draft !== (env.data?.content ?? "");
  const hasContent = (env.data?.content ?? "").trim().length > 0;

  const save = useMutation({
    mutationFn: () => api.saveEnv(projectId, value),
    onSuccess: (res) => {
      qc.setQueryData(["env", projectId], res);
      setDraft(null);
    },
  });

  // Загрузка .env с ПК: читаем файл локально и кладём в черновик, чтобы
  // пользователь видел содержимое перед «Сохранить».
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // сброс, чтобы тот же файл можно было выбрать повторно
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setUploadError("Файл слишком большой (макс. 1 МБ)");
      return;
    }
    try {
      const text = await file.text();
      setDraft(text);
      if (!open) setOpen(true); // раскрываем, чтобы пользователь увидел загруженное
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section>
      {/* Заметный сворачиваемый заголовок-карточка с короткой сводкой состояния .env. */}
      <button
        className={`mb-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition ${
          open
            ? "border-indigo-500/40 bg-indigo-500/10"
            : "border-edge bg-panel/60 hover:border-indigo-500/40 hover:bg-indigo-500/5"
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span aria-hidden className="text-base">
          ⚙️
        </span>
        <span className="text-sm font-semibold text-slate-100">Переменные окружения (.env)</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            dirty
              ? "bg-amber-500/15 text-amber-300"
              : hasContent
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-slate-500/15 text-slate-400"
          }`}
        >
          {dirty ? "несохранённые изменения" : hasContent ? "задан" : "не задан"}
        </span>
        <span
          className="ml-auto text-[10px] text-slate-400 transition-transform"
          style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}
        >
          ▶
        </span>
      </button>

      {open && (
        <div className="card space-y-3">
          <p className="text-xs text-slate-400">
            Шаблон .env проекта — хранится зашифрованным в панели (AES-256-GCM), общий для всех
            деплоев. Запись на сервер (<code className="rounded bg-ink px-1">{workdir.replace(/\/+$/, "")}/.env</code>, права 600)
            выполняется со страницы конкретного деплоя. Можно вставить вручную или загрузить файлом с ПК.
          </p>

          {env.isLoading ? (
            <Spinner />
          ) : (
            <EnvEditor value={value} onChange={(v) => setDraft(v)} />
          )}

          {/* Скрытый input — открывается по кнопке «Загрузить файл». Содержимое читается локально. */}
          <input
            ref={fileRef}
            type="file"
            accept=".env,.txt,text/plain"
            className="hidden"
            onChange={onPickFile}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primary"
              disabled={save.isPending || !dirty}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Spinner /> : dirty ? "Сохранить" : "Сохранено"}
            </button>
            <button
              className="btn-ghost"
              disabled={save.isPending}
              onClick={() => fileRef.current?.click()}
              title="Загрузить содержимое .env из файла на ПК"
            >
              Загрузить файл
            </button>

            {env.data?.updatedAt && (
              <span className="text-xs text-slate-500">
                сохранено {formatDate(env.data.updatedAt)}
              </span>
            )}
            {uploadError && <span className="text-xs text-rose-400">✖ {uploadError}</span>}
            {save.isError && (
              <span className="text-xs text-rose-400">{(save.error).message}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Редактор .env с подсветкой синтаксиса. textarea прозрачен по тексту и лежит
 * поверх подсвеченного слоя <pre>; оба синхронизируются по содержимому и скроллу.
 * Подсвечиваются: комментарии (# …) приглушённо, ключ KEY= — акцентно.
 */
function EnvEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const preRef = useRef<HTMLPreElement>(null);

  const onScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (preRef.current) {
      preRef.current.scrollTop = e.currentTarget.scrollTop;
      preRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  return (
    <div className="relative min-h-[160px] overflow-hidden rounded-lg border border-edge bg-ink">
      {/* Слой подсветки (под textarea). */}
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs leading-relaxed"
      >
        {highlightEnv(value)}
        {"\n"}
      </pre>
      {/* Поле ввода: прозрачный текст, видимая каретка. */}
      <textarea
        className="relative block min-h-[160px] w-full resize-y overflow-auto whitespace-pre-wrap break-words bg-transparent p-2 font-mono text-xs leading-relaxed text-transparent caret-slate-200 outline-none placeholder:text-slate-600"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={onScroll}
        placeholder={"# комментарий\nDATABASE_URL=postgres://...\nNODE_ENV=production"}
      />
    </div>
  );
}

/** Разбивает .env на подсвеченные строки: # комментарий, KEY=значение, прочее. */
function highlightEnv(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    const trimmed = line.trimStart();
    let node: React.ReactNode;

    if (trimmed.startsWith("#")) {
      node = <span className="italic text-slate-500">{line}</span>;
    } else {
      const eq = line.indexOf("=");
      if (eq > 0) {
        node = (
          <>
            <span className="text-sky-300">{line.slice(0, eq)}</span>
            <span className="text-slate-500">=</span>
            <span className="text-slate-200">{line.slice(eq + 1)}</span>
          </>
        );
      } else {
        node = <span className="text-slate-200">{line}</span>;
      }
    }

    return (
      <span key={i}>
        {node}
        {"\n"}
      </span>
    );
  });
}
