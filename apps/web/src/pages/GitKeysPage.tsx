import type {
  GenerateGitKeyInput,
  GitKeyPublic,
  ImportGitKeyInput,
} from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState, Modal, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

export function GitKeysPage() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["git-keys"], queryFn: api.listGitKeys });
  const [modal, setModal] = useState<"generate" | "import" | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const del = useMutation({
    mutationFn: api.deleteGitKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["git-keys"] }),
  });

  const refresh = () => {
    setModal(null);
    void qc.invalidateQueries({ queryKey: ["git-keys"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Git-ключи</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setModal("import")}>
            Импортировать
          </button>
          <button className="btn-primary" onClick={() => setModal("generate")}>
            + Сгенерировать
          </button>
        </div>
      </div>
      <GitKeysGuide open={showGuide} onToggle={() => setShowGuide((v) => !v)} />

      {keys.isLoading && <Spinner />}
      {keys.data?.length === 0 && (
        <EmptyState text="Git-ключей пока нет. Сгенерируйте пару для доступа к приватным репозиториям." />
      )}

      <div className="grid gap-3">
        {keys.data?.map((k) => (
          <GitKeyCard
            key={k.id}
            keyItem={k}
            onDelete={() => {
              if (
                confirm(
                  `Удалить git-ключ «${k.name}»? Проекты, раскатывающиеся с ним, потеряют доступ к репозиторию.`,
                )
              )
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

/** Памятка: как git-ключи используются для clone приватных репозиториев. */
function GitKeysGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="card border-indigo-500/30 bg-indigo-500/5">
      <button className="flex w-full items-center justify-between text-left" onClick={onToggle}>
        <span className="flex items-center gap-2 text-sm font-medium text-indigo-300">
          🔑 Как работают Git-ключи — краткий гайд
        </span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 text-sm text-slate-300">
          <p className="text-slate-400">
            Git-ключ нужен, чтобы панель могла склонировать <b>приватный</b> репозиторий на сервер.
            Это отдельная пара от ключей доступа к VPS: <b>публичную</b> часть вы добавляете как{" "}
            <b>Deploy key</b> в GitHub/GitLab, а <b>приватная</b> временно кладётся на сервер во время
            clone и тут же удаляется.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <GuideStep n="1" title="Сгенерируйте пару">
              Панель создаёт новую пару (рекомендуется ed25519). Приватная часть сразу шифруется
              (AES-256-GCM) и в API/интерфейс не отдаётся.
            </GuideStep>
            <GuideStep n="2" title="Добавьте публичный ключ в репозиторий">
              Скопируйте публичный ключ и добавьте его в <b>Settings → Deploy keys</b> вашего репо
              (GitHub/GitLab). Доступа только на чтение достаточно.
            </GuideStep>
            <GuideStep n="3" title="Создайте проект с источником «Private git»">
              В форме нового проекта выберите источник кода <b>«Private git»</b>, укажите ssh-URL
              (<code className="rounded bg-ink px-1 text-xs">git@github.com:org/repo.git</code>) и этот
              ключ.
            </GuideStep>
            <GuideStep n="4" title="Раскатайте">
              Кнопка <b>«Раскатить»</b> на странице проекта склонирует репозиторий в рабочую
              директорию. Дальше — обычный Deploy (git pull).
            </GuideStep>
          </div>

          <div className="rounded-lg border border-edge bg-ink/60 p-3 text-xs text-slate-400">
            <p>
              <b className="text-slate-300">Безопасность.</b> Приватный ключ во время clone лежит во
              временном файле на сервере (chmod 600) и удаляется сразу после — даже при ошибке. В логи
              его содержимое не попадает.
            </p>
            <p className="mt-2">
              <b className="text-slate-300">Один ключ — один репозиторий.</b> Deploy key в GitHub
              привязывается к конкретному репо; для разных приватных проектов удобно заводить разные
              ключи.
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

function GitKeyCard({ keyItem, onDelete }: { keyItem: GitKeyPublic; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);

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
          <span className="label mb-0">Публичный ключ (Deploy key для GitHub/GitLab)</span>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={copyPublic}>
            {copied ? "Скопировано ✓" : "Копировать"}
          </button>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-300">
          {keyItem.publicKey}
        </pre>
      </div>
    </div>
  );
}

function GenerateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<GenerateGitKeyInput>({ name: "", type: "ed25519" });
  const gen = useMutation({ mutationFn: api.generateGitKey, onSuccess: onSaved });

  return (
    <Modal title="Сгенерировать Git-ключ" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="repo-deploy-key"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Тип</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as GenerateGitKeyInput["type"] })
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
  const [form, setForm] = useState<ImportGitKeyInput>({ name: "", privateKey: "" });
  const imp = useMutation({ mutationFn: api.importGitKey, onSuccess: onSaved });

  return (
    <Modal title="Импортировать Git-ключ" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="my-existing-deploy-key"
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
