import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { EmptyState, Modal, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { openDeployLogDrawer } from "../lib/deployLogDrawer.js";
import { formatDate } from "../lib/format.js";
import { TestResult } from "./ServersPage.js";

function authLabel(method: "key" | "password" | "stored-key"): string {
  if (method === "stored-key") return "ключ из хранилища";
  if (method === "key") return "SSH-ключ";
  return "пароль";
}

export function ServerDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showTest, setShowTest] = useState(false);
  const [showHarden, setShowHarden] = useState(false);

  const server = useQuery({
    queryKey: ["server", id],
    queryFn: () => api.getServer(id),
  });

  const test = useMutation({ mutationFn: () => api.testServer(id) });
  const installDocker = useMutation({
    mutationFn: () => api.installDocker(id),
    onSuccess: (res) => {
      openDeployLogDrawer({
        runId: res.runId,
        projectName: server.data?.name ?? "сервер",
        title: "Установка Docker",
        invalidateKeys: [["server", id], ["servers"]],
      });
    },
  });
  const installNode = useMutation({
    mutationFn: () => api.installNode(id),
    onSuccess: (res) => {
      openDeployLogDrawer({
        runId: res.runId,
        projectName: server.data?.name ?? "сервер",
        title: "Установка Node/npm",
        invalidateKeys: [["server", id], ["servers"]],
      });
    },
  });
  const hardenSsh = useMutation({
    mutationFn: () => api.hardenSsh(id),
    onSuccess: (res) => {
      openDeployLogDrawer({
        runId: res.runId,
        projectName: server.data?.name ?? "сервер",
        title: "Настройка SSH",
        invalidateKeys: [["server", id], ["servers"]],
      });
    },
  });
  const removeServer = useMutation({
    mutationFn: () => api.deleteServer(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["servers"] });
      void navigate("/servers");
    },
  });

  if (server.isLoading) return <Spinner />;
  if (server.isError || !server.data) return <EmptyState text="Сервер не найден." />;

  const s = server.data;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/servers" className="btn-ghost mb-1.5 inline-flex items-center gap-1 px-2.5 py-1 text-xs">
            <span aria-hidden>←</span> Все серверы
          </Link>
          <h1 className="text-xl font-semibold">{s.name}</h1>
        </div>
      </div>

      <div className="card grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Host">
          <span className="font-mono text-xs">{s.host}</span>
        </Field>
        <Field label="Порт">{s.port}</Field>
        <Field label="Пользователь">{s.username}</Field>
        <Field label="Аутентификация">{authLabel(s.authMethod)}</Field>
        <Field label="Добавлен">{formatDate(s.createdAt)}</Field>
        <Field label="Обновлён">{formatDate(s.updatedAt)}</Field>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Обслуживание сервера
        </h2>
        <div className="card space-y-3">
          <div className="flex flex-wrap gap-2">
            <Link className="btn-primary" to={`/servers/${s.id}/terminal`}>
              Терминал
            </Link>
            <button
              className="btn-ghost"
              disabled={test.isPending}
              onClick={() => {
                setShowTest(true);
                test.reset();
                test.mutate();
              }}
            >
              {test.isPending ? <Spinner /> : "Проверить соединение"}
            </button>
            <button
              className="btn-primary"
              disabled={installDocker.isPending}
              title="Установить Docker Engine и Docker Compose plugin на сервер"
              onClick={() => installDocker.mutate()}
            >
              {installDocker.isPending ? <Spinner /> : "Установить Docker"}
            </button>
            <button
              className="btn-primary"
              disabled={installNode.isPending}
              title="Установить Node.js и npm на сервер"
              onClick={() => installNode.mutate()}
            >
              {installNode.isPending ? <Spinner /> : "Установить Node/npm"}
            </button>
            <button
              className="btn-ghost"
              disabled={hardenSsh.isPending}
              title="Применить рекомендуемые настройки SSH: лимиты подключений, keepalive, fail2ban"
              onClick={() => setShowHarden(true)}
            >
              {hardenSsh.isPending ? <Spinner /> : "Настроить SSH"}
            </button>
            <button
              className="btn-danger"
              disabled={removeServer.isPending}
              onClick={() => {
                if (confirm(`Удалить сервер «${s.name}»?`)) removeServer.mutate();
              }}
            >
              {removeServer.isPending ? <Spinner /> : "Удалить сервер"}
            </button>
          </div>

          {installDocker.isError && (
            <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
              {(installDocker.error).message}
            </div>
          )}
          {installNode.isError && (
            <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
              {(installNode.error).message}
            </div>
          )}
          {hardenSsh.isError && (
            <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
              {(hardenSsh.error).message}
            </div>
          )}
          {removeServer.isError && (
            <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
              {(removeServer.error).message}
            </div>
          )}
        </div>
      </section>

      {showTest && (
        <TestResult
          pending={test.isPending}
          result={test.data}
          httpError={test.isError ? (test.error).message : undefined}
          onClose={() => {
            setShowTest(false);
            test.reset();
          }}
        />
      )}

      {showHarden && (
        <HardenSshModal
          serverName={s.name}
          byKey={s.authMethod === "key" || s.authMethod === "stored-key"}
          pending={hardenSsh.isPending}
          onClose={() => setShowHarden(false)}
          onConfirm={() => {
            setShowHarden(false);
            hardenSsh.mutate();
          }}
        />
      )}
    </div>
  );
}

/**
 * Модалка подтверждения настройки SSH (hardening). Показывает, что именно будет
 * применено, и зависит от способа подключения: пароль отключаем только при входе
 * по ключу. Требует явного согласия (чекбокс).
 */
function HardenSshModal({
  serverName,
  byKey,
  pending,
  onClose,
  onConfirm,
}: {
  serverName: string;
  byKey: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <Modal title="Настройка SSH" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-300">
          Применим рекомендуемые настройки sshd на <b>{serverName}</b> — для стабильного соединения и
          защиты от брутфорса.
        </p>

        <div className="space-y-2">
          <HardenStep icon="📈" title="Лимиты подключений">
            <code className="rounded bg-ink px-1 text-xs">MaxStartups</code> /{" "}
            <code className="rounded bg-ink px-1 text-xs">MaxSessions</code> /{" "}
            <code className="rounded bg-ink px-1 text-xs">LoginGraceTime</code> — всплески и атаки не
            рвут легитимные коннекты.
          </HardenStep>
          <HardenStep icon="💓" title="Keepalive">
            <code className="rounded bg-ink px-1 text-xs">ClientAliveInterval</code> — sshd сам
            закрывает зависшие сессии, меньше мёртвых каналов.
          </HardenStep>
          <HardenStep icon="🛡️" title="fail2ban">
            Автобан IP, которые перебирают пароли.
          </HardenStep>
          {byKey ? (
            <HardenStep icon="🔑" title="Отключение парольного входа" accent="amber">
              <code className="rounded bg-ink px-1 text-xs">PasswordAuthentication no</code> — вход
              только по ключу. Сервер подключён по ключу, поэтому доступ не потеряется.
            </HardenStep>
          ) : (
            <HardenStep icon="🔑" title="Парольный вход не трогаем" accent="slate">
              Сервер подключён <b>по паролю</b> — отключать его не будем, чтобы не отрезать доступ.
              Чтобы запретить пароль, переключите сервер на вход по ключу.
            </HardenStep>
          )}
        </div>

        <div className="rounded-lg border border-edge bg-ink/60 p-3 text-xs text-slate-400">
          Изменения пишутся в drop-in <code className="rounded bg-ink px-1">sshd_config.d/</code>,
          проверяются через <code className="rounded bg-ink px-1">sshd -t</code> и применяются по{" "}
          <b>reload</b> — текущее соединение не оборвётся. Перед изменением делается бэкап.
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            Понимаю, что настройки изменят конфигурацию sshd на сервере
            {byKey ? " и отключат вход по паролю" : ""}.
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" disabled={!agreed || pending} onClick={onConfirm}>
            {pending ? <Spinner /> : "Настроить SSH"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HardenStep({
  icon,
  title,
  accent = "default",
  children,
}: {
  icon: string;
  title: string;
  accent?: "default" | "amber" | "slate";
  children: React.ReactNode;
}) {
  const ring =
    accent === "amber"
      ? "border-amber-500/40 bg-amber-500/5"
      : accent === "slate"
        ? "border-edge bg-edge/30"
        : "border-edge bg-ink/40";
  return (
    <div className={`flex gap-3 rounded-lg border p-2.5 ${ring}`}>
      <span className="text-base leading-none">{icon}</span>
      <div>
        <div className="text-sm font-medium text-slate-200">{title}</div>
        <div className="mt-0.5 text-xs text-slate-400">{children}</div>
      </div>
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
