import type { ConnectionTestResult, CreateServerInput } from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, Modal, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

const emptyForm: CreateServerInput = {
  name: "",
  host: "",
  port: 22,
  username: "",
  credentials: { authMethod: "key", privateKey: "" },
};

export function ServersPage() {
  const qc = useQueryClient();
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Серверы</h1>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Добавить сервер
        </button>
      </div>

      {servers.isLoading && <Spinner />}
      {servers.data?.length === 0 && <EmptyState text="Пока нет серверов. Добавьте первый VPS." />}

      <div className="grid gap-3">
        {servers.data?.map((s) => (
          <Link
            key={s.id}
            to={`/servers/${s.id}`}
            className="card flex items-center justify-between hover:border-indigo-500/40"
          >
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-sm text-slate-400">
                {s.username}@{s.host}
              </div>
              <div className="text-xs text-slate-500">добавлен {formatDate(s.createdAt)}</div>
            </div>
            <div className="flex items-center gap-2">
              {/* Отдельное действие — открывает терминал, не должно триггерить переход к карточке. */}
              <Link
                className="btn-ghost"
                to={`/servers/${s.id}/terminal`}
                onClick={(e) => e.stopPropagation()}
              >
                Терминал
              </Link>
            </div>
          </Link>
        ))}
      </div>

      {showForm && (
        <ServerFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void qc.invalidateQueries({ queryKey: ["servers"] });
          }}
        />
      )}
    </div>
  );
}

export function TestResult({
  pending,
  result,
  httpError,
  onClose,
}: {
  pending: boolean;
  result: ConnectionTestResult | undefined;
  httpError: string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal title="Проверка соединения" onClose={onClose}>
      {pending ? (
        <div className="flex items-center gap-3 text-slate-300">
          <Spinner />
          <span>Подключаемся к серверу по SSH…</span>
        </div>
      ) : httpError ? (
        <div className="space-y-2">
          <p className="text-rose-400">✖ Не удалось выполнить проверку</p>
          <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-xs text-rose-300">
            {httpError}
          </pre>
        </div>
      ) : result?.ok ? (
        <div className="space-y-2">
          <p className="text-emerald-400">✔ Соединение успешно ({result.latencyMs} мс)</p>
          <p className="text-sm text-slate-400">Сервер ответил на SSH-подключение. Вывод `uname -a`:</p>
          <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-xs text-slate-300">
            {result.uname}
          </pre>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-rose-400">✖ Ошибка соединения</p>
          <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-xs text-rose-300">
            {result?.error ?? "Неизвестная ошибка"}
          </pre>
        </div>
      )}
    </Modal>
  );
}

function ServerFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreateServerInput>(emptyForm);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const keys = useQuery({ queryKey: ["keys"], queryFn: api.listKeys });

  const testRaw = useMutation({
    mutationFn: api.testServerRaw,
    onSuccess: setTestResult,
  });
  const create = useMutation({ mutationFn: api.createServer, onSuccess: onSaved });

  const setCred = (patch: Partial<CreateServerInput["credentials"]>) =>
    setForm((f) => ({ ...f, credentials: { ...f.credentials, ...patch } }));

  return (
    <Modal title="Новый сервер" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Прод VPS"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="label">Host / IP</label>
            <input
              className="input"
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              onBlur={(e) => setForm({ ...form, host: e.target.value.trim() })}
              placeholder="203.0.113.10"
            />
          </div>
          <div>
            <label className="label">Порт</label>
            <input
              className="input"
              type="number"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            />
          </div>
        </div>
        <div>
          <label className="label">Пользователь SSH</label>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="deploy"
          />
        </div>
        <div>
          <label className="label">Метод аутентификации</label>
          <select
            className="input"
            value={form.credentials.authMethod}
            onChange={(e) => {
              const m = e.target.value;
              setForm({
                ...form,
                keyId: m === "stored-key" ? (keys.data?.[0]?.id ?? "") : undefined,
                credentials:
                  m === "key"
                    ? { authMethod: "key", privateKey: "" }
                    : m === "password"
                      ? { authMethod: "password", password: "" }
                      : { authMethod: "stored-key" },
              });
            }}
          >
            <option value="stored-key">Ключ из хранилища</option>
            <option value="key">Вставить SSH-ключ</option>
            <option value="password">Пароль</option>
          </select>
        </div>

        {form.credentials.authMethod === "stored-key" ? (
          <div>
            <label className="label">Ключ из хранилища</label>
            {keys.data?.length ? (
              <select
                className="input"
                value={form.keyId ?? ""}
                onChange={(e) => setForm({ ...form, keyId: e.target.value })}
              >
                {keys.data.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.type}) · {k.fingerprint.slice(0, 24)}…
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-amber-400">
                В хранилище нет ключей. Создайте ключ на вкладке «Ключи» или выберите другой метод.
              </p>
            )}
          </div>
        ) : form.credentials.authMethod === "key" ? (
          <>
            <div>
              <label className="label">Приватный ключ (PEM)</label>
              <textarea
                className="input font-mono text-xs"
                rows={5}
                value={form.credentials.privateKey ?? ""}
                onChange={(e) => setCred({ privateKey: e.target.value })}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </div>
            <div>
              <label className="label">Passphrase (если есть)</label>
              <input
                className="input"
                type="password"
                value={form.credentials.passphrase ?? ""}
                onChange={(e) => setCred({ passphrase: e.target.value })}
              />
            </div>
          </>
        ) : (
          <div>
            <label className="label">Пароль</label>
            <input
              className="input"
              type="password"
              value={form.credentials.password ?? ""}
              onChange={(e) => setCred({ password: e.target.value })}
            />
          </div>
        )}

        {testResult && (
          <div
            className={`rounded-lg p-2 text-xs ${
              testResult.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
            }`}
          >
            {testResult.ok ? `✔ ${testResult.uname}` : `✖ ${testResult.error}`}
          </div>
        )}

        {create.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {create.error.message}
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <button
            className="btn-ghost"
            disabled={testRaw.isPending}
            onClick={() => testRaw.mutate(form)}
          >
            {testRaw.isPending ? <Spinner /> : "Проверить соединение"}
          </button>
          <button
            className="btn-primary"
            disabled={create.isPending}
            onClick={() => create.mutate(form)}
          >
            {create.isPending ? <Spinner /> : "Сохранить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
