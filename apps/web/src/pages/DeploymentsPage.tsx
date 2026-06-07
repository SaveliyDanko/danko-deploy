import type { ProjectPublic, ServerPublic } from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { EmptyState, Modal, Spinner, StatusBadge } from "../components/ui.js";
import { api } from "../lib/api.js";
import { openDeployLogDrawer } from "../lib/deployLogDrawer.js";
import { formatDate } from "../lib/format.js";

export function DeploymentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [backupRunningId, setBackupRunningId] = useState<string | null>(null);

  const deployments = useQuery({ queryKey: ["deployments"], queryFn: api.listDeployments });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });

  const projectById = (id: string) => projects.data?.find((p) => p.id === id);
  const projectName = (id: string) => projectById(id)?.name ?? id;
  const serverName = (id: string) => servers.data?.find((s) => s.id === id)?.name ?? id;
  const hasBackup = (projectId: string) => {
    const config = projectById(projectId)?.config;
    return !!config && (!!config.backupArtifacts?.length || !!config.backupCommand);
  };

  const quickBackup = useMutation({
    mutationFn: api.runBackup,
    onMutate: (deploymentId) => {
      setBackupRunningId(deploymentId);
    },
    onSuccess: (res, deploymentId) => {
      const deployment = deployments.data?.find((item) => item.id === deploymentId);
      openDeployLogDrawer({
        runId: res.runId,
        projectName: deployment ? projectName(deployment.projectId) : deploymentId,
        title: "Backup",
        invalidateKeys: [["projects"], ["deployments"], ...(deployment ? [["backups", deployment.projectId]] : [])],
      });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onSettled: () => {
      setBackupRunningId(null);
    },
  });

  const canCreate = !!projects.data?.length && !!servers.data?.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Деплои</h1>
        <button
          className="btn-primary"
          disabled={!canCreate}
          title={
            !projects.data?.length
              ? "Сначала создайте проект"
              : !servers.data?.length
                ? "Сначала добавьте сервер"
                : ""
          }
          onClick={() => setShowForm(true)}
        >
          + Новый деплой
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Деплой — это проект, развёрнутый на конкретном сервере. Один проект можно развернуть на
        несколько серверов: создайте по деплою на каждый.
      </p>
      {quickBackup.isError && (
        <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
          {(quickBackup.error).message}
        </div>
      )}

      {deployments.isLoading && <Spinner />}
      {deployments.data?.length === 0 && (
        <EmptyState text="Деплоев пока нет. Выберите проект и сервер." />
      )}

      <div className="grid gap-3">
        {deployments.data?.map((d) => {
          const backupEnabled = hasBackup(d.projectId);
          return (
            <Link
              key={d.id}
              to={`/deployments/${d.id}`}
              className="card flex items-center justify-between hover:border-indigo-500/40"
            >
              <div>
                <div className="font-medium">
                  {projectName(d.projectId)}{" "}
                  <span className="text-slate-500">→ {serverName(d.serverId)}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {d.lastDeployAt ? `последний деплой ${formatDate(d.lastDeployAt)}` : "ещё не раскатан"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {d.lastDeployStatus ? (
                  <StatusBadge status={d.lastDeployStatus} />
                ) : (
                  <span className="text-xs text-slate-500">—</span>
                )}
                {/* Быстрый бэкап — отдельное действие, не должно триггерить переход к карточке. */}
                <button
                  className="btn-ghost"
                  disabled={!!backupRunningId || !backupEnabled}
                  title={!backupEnabled ? "Бэкап не настроен в проекте" : "Сделать бэкап"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    quickBackup.mutate(d.id);
                  }}
                >
                  {backupRunningId === d.id ? <Spinner /> : "Бэкап"}
                </button>
              </div>
            </Link>
          );
        })}
      </div>

      {showForm && projects.data && servers.data && (
        <NewDeploymentModal
          projects={projects.data}
          servers={servers.data}
          onClose={() => setShowForm(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["deployments"] })}
        />
      )}

    </div>
  );
}

/** Модалка создания деплоя: выбор проекта + сервера (единственная точка создания). */
function NewDeploymentModal({
  projects,
  servers,
  onClose,
  onCreated,
}: {
  projects: ProjectPublic[];
  servers: ServerPublic[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");

  const create = useMutation({
    mutationFn: () => api.createDeployment({ projectId, serverId }),
    onSuccess: (d) => {
      onCreated();
      onClose();
      void navigate(`/deployments/${d.id}`);
    },
  });

  return (
    <Modal title="Новый деплой" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-400">
          Свяжет проект с сервером. Конфиг (workdir, источник кода, команды бэкапа) подтянется из
          карточки проекта. Раскатка запускается на странице деплоя.
        </p>
        <div>
          <label className="label">Проект</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Сервер</label>
          <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {create.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(create.error).message}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-primary"
            disabled={create.isPending || !projectId || !serverId}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner /> : "Создать деплой"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
