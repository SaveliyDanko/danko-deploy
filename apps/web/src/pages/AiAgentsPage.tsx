import type { AiAgentPublic, AiAgentStatus, CreateAiAgentInput } from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { AiDeployDrawer } from "../components/AiDeployDrawer.js";
import { EmptyState, Modal, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

const agentTypeLabels: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

function AgentStatusBadge({ status }: { status: AiAgentStatus }) {
  const map: Record<AiAgentStatus, string> = {
    installing: "bg-amber-500/15 text-amber-400",
    uninstalling: "bg-amber-500/15 text-amber-400",
    ready: "bg-emerald-500/15 text-emerald-400",
    running: "bg-emerald-500/15 text-emerald-400",
    stopped: "bg-slate-500/15 text-slate-400",
    error: "bg-rose-500/15 text-rose-400",
  };
  const labels: Record<AiAgentStatus, string> = {
    installing: "установка…",
    uninstalling: "удаление…",
    ready: "готов",
    running: "работает",
    stopped: "остановлен",
    error: "ошибка",
  };
  return <span className={`badge ${map[status]}`}>{labels[status]}</span>;
}

export function AiAgentsPage() {
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ["ai-agents"], queryFn: api.listAiAgents });
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });
  const [showForm, setShowForm] = useState(false);
  const [activeJob, setActiveJob] = useState<{ id: string; name: string; title: string } | null>(
    null,
  );
  const [uninstallTarget, setUninstallTarget] = useState<AiAgentPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiAgentPublic | null>(null);

  const del = useMutation({
    mutationFn: api.deleteAiAgent,
    onSuccess: () => {
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: ["ai-agents"] });
    },
  });
  const deploy = useMutation({
    mutationFn: (id: string) => api.deployAiAgent(id),
  });
  const uninstall = useMutation({
    mutationFn: api.uninstallAiAgent,
  });
  const stop = useMutation({
    mutationFn: api.stopAiAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-agents"] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-agents"] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">AI-агенты</h1>
        <button
          className="btn-primary"
          disabled={!servers.data?.length}
          title={!servers.data?.length ? "Сначала добавьте сервер" : ""}
          onClick={() => setShowForm(true)}
        >
          + Развернуть агента
        </button>
      </div>
      <p className="text-sm text-slate-400">
        Разворачивает Claude Code / Codex на сервере в tmux-сессии. Доступ — через веб-терминал,
        в т.ч. с телефона. Авторизация агента (вход в аккаунт) делается один раз прямо в терминале.
      </p>

      {agents.isLoading && <Spinner />}
      {agents.data?.length === 0 && (
        <EmptyState text="Агентов пока нет. Разверните первого." />
      )}

      <div className="grid gap-3">
        {agents.data?.map((a) => (
          <div key={a.id} className="card flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <AgentStatusBadge status={a.status} />
              </div>
              <div className="text-sm text-slate-400">
                {agentTypeLabels[a.agentType] ?? a.agentType} · {a.workdir}
              </div>
              <div className="text-xs text-slate-500">создан {formatDate(a.createdAt)}</div>
              {a.lastError && <div className="text-xs text-rose-400">{a.lastError}</div>}
            </div>
            <div className="flex items-center gap-2">
              <Link to={`/ai/${a.id}/terminal`} className="btn-primary">
                Терминал
              </Link>
              <button
                className="btn-ghost"
                disabled={deploy.isPending}
                onClick={() =>
                  deploy.mutate(a.id, {
                    onSuccess: () => setActiveJob({ id: a.id, name: a.name, title: "Установка" }),
                  })
                }
              >
                {a.status === "stopped" || a.status === "error" ? "Установить/запустить" : "Переустановить"}
              </button>
              {a.status === "running" && (
                <button className="btn-ghost" onClick={() => stop.mutate(a.id)}>
                  Стоп
                </button>
              )}
              <button
                className="btn-ghost"
                disabled={uninstall.isPending || a.status === "uninstalling"}
                onClick={() => setUninstallTarget(a)}
              >
                Удалить с сервера
              </button>
              <button
                className="btn-danger"
                onClick={() => setDeleteTarget(a)}
              >
                Удалить из панели
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && servers.data && (
        <AgentFormModal
          servers={servers.data}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      )}

      {uninstallTarget && (
        <Modal title="Удалить CLI с сервера?" onClose={() => setUninstallTarget(null)}>
          <div className="space-y-4 text-sm text-slate-300">
            <p>
              Это остановит tmux-сессию <span className="font-mono">{uninstallTarget.tmuxSession}</span> и
              удалит {agentTypeLabels[uninstallTarget.agentType] ?? uninstallTarget.agentType} с сервера через{" "}
              <span className="font-mono">npm uninstall -g</span>.
            </p>
            <p className="text-slate-400">
              Запись агента останется в панели, чтобы его можно было установить повторно.
            </p>
            {uninstall.isError && (
              <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
                {(uninstall.error).message}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setUninstallTarget(null)}>
                Отмена
              </button>
              <button
                className="btn-danger"
                disabled={uninstall.isPending}
                onClick={() =>
                  uninstall.mutate(uninstallTarget.id, {
                    onSuccess: () => {
                      setActiveJob({
                        id: uninstallTarget.id,
                        name: uninstallTarget.name,
                        title: "Удаление",
                      });
                      setUninstallTarget(null);
                    },
                  })
                }
              >
                {uninstall.isPending ? <Spinner /> : "Удалить с сервера"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Удалить агента из панели?" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4 text-sm text-slate-300">
            <p>
              Запись <span className="font-medium text-slate-100">{deleteTarget.name}</span> исчезнет из
              списка AI-агентов в панели.
            </p>
            <p className="text-slate-400">
              CLI на сервере и tmux-сессия не удаляются. Чтобы убрать сам Claude Code или Codex с VPS,
              сначала используйте «Удалить с сервера».
            </p>
            {del.isError && (
              <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
                {(del.error).message}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setDeleteTarget(null)}>
                Отмена
              </button>
              <button
                className="btn-danger"
                disabled={del.isPending}
                onClick={() => del.mutate(deleteTarget.id)}
              >
                {del.isPending ? <Spinner /> : "Удалить из панели"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeJob && (
        <AiDeployDrawer
          agentId={activeJob.id}
          agentName={activeJob.name}
          title={activeJob.title}
          onClose={() => setActiveJob(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

const emptyAgent: CreateAiAgentInput = {
  name: "",
  serverId: "",
  agentType: "claude-code",
  workdir: "~",
};

function AgentFormModal({
  servers,
  onClose,
  onSaved,
}: {
  servers: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreateAiAgentInput>({
    ...emptyAgent,
    serverId: servers[0]?.id ?? "",
  });
  const create = useMutation({ mutationFn: api.createAiAgent, onSuccess: onSaved });

  return (
    <Modal title="Развернуть AI-агента" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="claude-on-prod"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Сервер</label>
            <select
              className="input"
              value={form.serverId}
              onChange={(e) => setForm({ ...form, serverId: e.target.value })}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Агент</label>
            <select
              className="input"
              value={form.agentType}
              onChange={(e) =>
                setForm({ ...form, agentType: e.target.value as CreateAiAgentInput["agentType"] })
              }
            >
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Рабочая директория</label>
          <input
            className="input"
            value={form.workdir}
            onChange={(e) => setForm({ ...form, workdir: e.target.value })}
            placeholder="~/projects/myapp"
          />
        </div>
        {create.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(create.error).message}
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button
            className="btn-primary"
            disabled={create.isPending}
            onClick={() => create.mutate(form)}
          >
            {create.isPending ? <Spinner /> : "Создать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
