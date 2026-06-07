import type {
  GenerateSshKeyInput,
  ImportSshKeyInput,
  ServerPublic,
  SshKeyPublic,
} from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState, Modal, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

export function KeysPage() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["keys"], queryFn: api.listKeys });
  const servers = useQuery({ queryKey: ["servers"], queryFn: api.listServers });
  const [modal, setModal] = useState<"generate" | "import" | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const del = useMutation({
    mutationFn: api.deleteKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }),
  });

  const refresh = () => {
    setModal(null);
    void qc.invalidateQueries({ queryKey: ["keys"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">SSH-ключи</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setModal("import")}>
            Импортировать
          </button>
          <button className="btn-primary" onClick={() => setModal("generate")}>
            + Сгенерировать
          </button>
        </div>
      </div>
      <KeysGuide open={showGuide} onToggle={() => setShowGuide((v) => !v)} />

      {keys.isLoading && <Spinner />}
      {keys.data?.length === 0 && (
        <EmptyState text="Ключей пока нет. Сгенерируйте новую пару или импортируйте существующий." />
      )}

      <div className="grid gap-3">
        {keys.data?.map((k) => (
          <KeyCard
            key={k.id}
            keyItem={k}
            servers={servers.data ?? []}
            onDelete={() => {
              if (confirm(`Удалить ключ «${k.name}»? Серверы, использующие его, потеряют доступ.`))
                del.mutate(k.id);
            }}
          />
        ))}
      </div>

      {modal === "generate" && <GenerateModal onClose={() => setModal(null)} onSaved={refresh} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onSaved={refresh} />}
    </div>
  );
}

/** Краткая памятка: как работают SSH-ключи в DankoDeploy. Сворачивается, чтобы не мешать. */
function KeysGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="card border-indigo-500/30 bg-indigo-500/5">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-indigo-300">
          🔑 Как работают SSH-ключи — краткий гайд
        </span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 text-sm text-slate-300">
          <p className="text-slate-400">
            Ключ — это пара из <b>приватной</b> и <b>публичной</b> части. Публичная кладётся на
            сервер, приватная остаётся секретом и подтверждает, что подключаетесь именно вы.
            DankoDeploy хранит ключи у себя, чтобы не вставлять приватник в каждый сервер вручную.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <GuideStep n="1" title="Создайте или импортируйте">
              <b>Сгенерировать</b> — панель создаёт новую пару (рекомендуется ed25519).{" "}
              <b>Импортировать</b> — вставьте уже существующий приватный ключ.
            </GuideStep>
            <GuideStep n="2" title="Приватный ключ шифруется">
              Приватная часть сразу шифруется (AES-256-GCM) и в базе лежит{" "}
              <b>только в зашифрованном виде</b>. В интерфейс и API она никогда не отдаётся — видны
              лишь публичный ключ и fingerprint.
            </GuideStep>
            <GuideStep n="3" title="Разверните на сервер">
              Кнопка <b>«Развернуть»</b> добавляет публичный ключ в{" "}
              <code className="rounded bg-ink px-1 text-xs">~/.ssh/authorized_keys</code> на
              выбранном сервере. Повторное нажатие безопасно — дубликат не создаётся.
            </GuideStep>
            <GuideStep n="4" title="Привяжите к серверу">
              При добавлении сервера выберите метод{" "}
              <b>«Ключ из хранилища»</b> и нужный ключ. Один ключ можно использовать для многих
              серверов — обновляете в одном месте.
            </GuideStep>
          </div>

          <div className="rounded-lg border border-edge bg-ink/60 p-3 text-xs text-slate-400">
            <p>
              <b className="text-slate-300">Безопасность.</b> Расшифровка возможна только мастер-ключом{" "}
              <code className="rounded bg-ink px-1">DANKODEPLOY_MASTER_KEY</code> (из переменных
              окружения, не хранится в базе). Без него восстановить приватные ключи нельзя — берегите
              его и не теряйте.
            </p>
            <p className="mt-2">
              <b className="text-slate-300">Удаление.</b> Если удалить ключ, серверы, которые на него
              ссылались, потеряют доступ (привязка обнулится) — назначьте им другой ключ.
            </p>
            <p className="mt-2">
              <b className="text-slate-300">Развёртывание требует доступа.</b> Чтобы добавить ключ на
              сервер, у панели уже должен быть рабочий доступ к нему (другой ключ или пароль). На
              совсем новый сервер первый ключ обычно кладёт хостинг-провайдер.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function GuideStep({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
        {n}
      </span>
      <div>
        <div className="font-medium text-slate-200">{title}</div>
        <div className="text-xs text-slate-400">{children}</div>
      </div>
    </div>
  );
}

function KeyCard({
  keyItem,
  servers,
  onDelete,
}: {
  keyItem: SshKeyPublic;
  servers: ServerPublic[];
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [deployServer, setDeployServer] = useState(servers[0]?.id ?? "");
  const deploy = useMutation({
    mutationFn: () => api.deployKey(keyItem.id, deployServer),
  });

  const copyPublic = async () => {
    await navigator.clipboard.writeText(keyItem.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium">{keyItem.name}</div>
          <div className="text-xs uppercase text-slate-500">{keyItem.type}</div>
          <div className="mt-1 font-mono text-xs text-slate-400">{keyItem.fingerprint}</div>
          <div className="text-xs text-slate-500">добавлен {formatDate(keyItem.createdAt)}</div>
        </div>
        <button className="btn-danger" onClick={onDelete}>
          Удалить
        </button>
      </div>

      <div className="rounded-lg bg-ink p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">Публичный ключ</span>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={copyPublic}>
            {copied ? "Скопировано ✓" : "Копировать"}
          </button>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-300">
          {keyItem.publicKey}
        </pre>
      </div>

      {servers.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Развернуть на:</span>
          <select
            className="input max-w-[200px] py-1 text-xs"
            value={deployServer}
            onChange={(e) => setDeployServer(e.target.value)}
          >
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            disabled={deploy.isPending || !deployServer}
            onClick={() => deploy.mutate()}
          >
            {deploy.isPending ? <Spinner /> : "Развернуть"}
          </button>
          {deploy.data && (
            <span className={deploy.data.ok ? "text-xs text-emerald-400" : "text-xs text-rose-400"}>
              {deploy.data.ok ? "✓ " : "✖ "}
              {deploy.data.message}
            </span>
          )}
          {deploy.isError && (
            <span className="text-xs text-rose-400">{(deploy.error).message}</span>
          )}
        </div>
      )}
    </div>
  );
}

function GenerateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<GenerateSshKeyInput>({ name: "", type: "ed25519" });
  const gen = useMutation({ mutationFn: api.generateKey, onSuccess: onSaved });

  return (
    <Modal title="Сгенерировать SSH-ключ" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="deploy-key"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Тип</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as GenerateSshKeyInput["type"] })
              }
            >
              <option value="ed25519">ed25519 (рекомендуется)</option>
              <option value="rsa">RSA 4096</option>
            </select>
          </div>
          <div>
            <label className="label">Passphrase (опц.)</label>
            <input
              className="input"
              type="password"
              value={form.passphrase ?? ""}
              onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
            />
          </div>
        </div>
        {gen.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(gen.error).message}
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button className="btn-primary" disabled={gen.isPending} onClick={() => gen.mutate(form)}>
            {gen.isPending ? <Spinner /> : "Сгенерировать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ImportSshKeyInput>({ name: "", privateKey: "" });
  const imp = useMutation({ mutationFn: api.importKey, onSuccess: onSaved });

  return (
    <Modal title="Импортировать SSH-ключ" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="my-existing-key"
          />
        </div>
        <div>
          <label className="label">Приватный ключ (PEM)</label>
          <textarea
            className="input font-mono text-xs"
            rows={6}
            value={form.privateKey}
            onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </div>
        <div>
          <label className="label">Passphrase (если ключ зашифрован)</label>
          <input
            className="input"
            type="password"
            value={form.passphrase ?? ""}
            onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
          />
        </div>
        {imp.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(imp.error).message}
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button className="btn-primary" disabled={imp.isPending} onClick={() => imp.mutate(form)}>
            {imp.isPending ? <Spinner /> : "Импортировать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
