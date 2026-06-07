import type { ImportMode, ImportResult } from "@dankodeploy/shared";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Modal, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";

/**
 * Окно «Бэкап»: экспорт/импорт всей конфигурации панели (серверы, ключи, проекты,
 * деплои, .env и опционально файлы бэкапов). Секреты зашифрованы под пароль экспорта.
 */
export function BackupPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Бэкап конфигурации</h1>
      <p className="text-sm text-slate-400">
        Сохраните или восстановите всю конфигурацию DankoDeploy: серверы, SSH- и Git-ключи, проекты,
        деплои, сохранённые <code className="rounded bg-ink px-1">.env</code> и историю бэкапов.
        Приватные ключи, пароли серверов и .env <b>зашифрованы под пароль экспорта</b> — в открытом
        виде их в файле нет. Экспорт — ZIP-архив.
      </p>

      <ExportBlock />
      <ImportBlock />
    </div>
  );
}

function ExportBlock() {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [includeFiles, setIncludeFiles] = useState(false);
  const mismatch = repeat.length > 0 && password !== repeat;

  const exportMut = useMutation({
    mutationFn: () => api.exportConfig(password, includeFiles),
    onSuccess: ({ blob, filename }) => {
      // Скачиваем файл: создаём временную ссылку на Blob.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setPassword("");
      setRepeat("");
    },
  });

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Экспорт</h2>
      <div className="card space-y-3">
        <p className="text-xs text-slate-400">
          Задайте пароль — им будут зашифрованы секреты в файле. <b>Запомните его</b>: без пароля
          восстановить бэкап нельзя.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <label className="label">Пароль экспорта</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="минимум 1 символ"
            />
          </div>
          <div>
            <label className="label">Повтор пароля</label>
            <input
              type="password"
              className="input"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includeFiles}
            onChange={(e) => setIncludeFiles(e.target.checked)}
          />
          <span>
            Включить <b>файлы бэкапов проектов</b> (.bak) в архив. Без галочки сохраняется только
            история бэкапов (метаданные) — архив лёгкий. С галочкой файлы могут быть большими.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={exportMut.isPending || !password || mismatch}
            onClick={() => exportMut.mutate()}
          >
            {exportMut.isPending ? <Spinner /> : "Скачать бэкап"}
          </button>
          {mismatch && <span className="text-xs text-rose-400">Пароли не совпадают</span>}
          {exportMut.isError && (
            <span className="text-xs text-rose-400">{(exportMut.error).message}</span>
          )}
          {exportMut.isSuccess && (
            <span className="text-xs text-emerald-400">✔ файл скачан</span>
          )}
        </div>
      </div>
    </section>
  );
}

function ImportBlock() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importMut = useMutation({
    mutationFn: () => api.importConfig(password, mode, file!),
    onSuccess: (res) => {
      setResult(res);
      setConfirmReplace(false);
    },
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setResult(null);
    const picked = e.target.files?.[0] ?? null;
    e.target.value = "";
    setFile(picked);
  };

  const start = () => {
    if (mode === "replace") setConfirmReplace(true);
    else importMut.mutate();
  };

  const counts = result?.counts;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Импорт</h2>
      <div className="card space-y-3">
        <p className="text-xs text-slate-400">
          Загрузите файл бэкапа (ZIP или старый JSON) и введите пароль, под которым он был сделан.
          Секреты будут перешифрованы под текущий ключ панели; файлы бэкапов из архива — сохранены в
          BACKUP_DIR.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          className="hidden"
          onChange={onPickFile}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
            Выбрать файл
          </button>
          {file && <span className="text-xs text-slate-400">{file.name}</span>}
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <label className="label">Пароль бэкапа</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Режим</label>
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as ImportMode)}
            >
              <option value="merge">Merge — добавить/обновить по id</option>
              <option value="replace">Replace — заменить всю конфигурацию</option>
            </select>
          </div>
        </div>

        {mode === "replace" && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
            Replace удалит текущие серверы, ключи, проекты и деплои перед импортом. История деплоев и
            бэкапов привязанных проектов тоже удалится (cascade). Файлы на серверах не затрагиваются.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={importMut.isPending || !file || !password}
            onClick={start}
          >
            {importMut.isPending ? <Spinner /> : "Импортировать"}
          </button>
          {importMut.isError && (
            <span className="text-xs text-rose-400">{(importMut.error).message}</span>
          )}
        </div>

        {counts && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
            ✔ Импорт завершён ({result.mode}). Загружено: серверы {counts.servers}, SSH-ключи{" "}
            {counts.sshKeys}, Git-ключи {counts.gitKeys}, проекты {counts.projects}, деплои{" "}
            {counts.deployments}, .env {counts.projectEnv}, бэкапы {counts.backups}
            {result.restoredFiles > 0 ? ` (файлов восстановлено: ${result.restoredFiles})` : ""}.
          </div>
        )}
      </div>

      {confirmReplace && (
        <Modal title="Заменить всю конфигурацию?" onClose={() => setConfirmReplace(false)}>
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              Текущие серверы, ключи, проекты, деплои и их история будут <b>удалены</b> и заменены
              содержимым файла. Действие необратимо.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmReplace(false)}>
                Отмена
              </button>
              <button
                className="btn-danger"
                disabled={importMut.isPending}
                onClick={() => importMut.mutate()}
              >
                {importMut.isPending ? <Spinner /> : "Заменить и импортировать"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
