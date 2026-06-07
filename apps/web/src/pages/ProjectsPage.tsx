import type {
  BackupArtifact,
  CreateProjectInput,
  ProjectMeta,
  ProjectPublic,
  ServiceKind,
} from "@dankodeploy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, Modal, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";

export function ProjectsPage() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const [showForm, setShowForm] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Проекты</h1>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Новый проект
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Проект — карточка сервиса без привязки к серверу. Чтобы раскатать его на сервер, создайте{" "}
        <Link to="/deployments" className="text-indigo-400 hover:underline">
          деплой
        </Link>
        .
      </p>

      <PreparePromptCard open={showPrompt} onToggle={() => setShowPrompt((v) => !v)} />

      {projects.isLoading && <Spinner />}
      {projects.data?.length === 0 && <EmptyState text="Нет проектов. Создайте первый." />}

      <div className="grid gap-3">
        {projects.data?.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}`}
            className="card flex items-center justify-between hover:border-indigo-500/40"
          >
            <div>
              <div className="font-medium hover:text-indigo-400">{p.name}</div>
              <div className="text-sm text-slate-400">
                {p.stack ?? p.description ?? "Описание не задано"}
              </div>
            </div>
            <span className="text-xs text-slate-500">{p.config.workdir}</span>
          </Link>
        ))}
      </div>

      {showForm && (
        <ProjectFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void qc.invalidateQueries({ queryKey: ["projects"] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Промпт для LLM-агента в ДРУГОМ репозитории: вставляешь — агент приводит проект к форме,
 * которую умеет деплоить DankoDeploy (см. docs/SERVICE-SPEC.md). Самодостаточный, без ссылок.
 */
const PREPARE_PROMPT = `Подготовь этот репозиторий к автоматическому деплою через панель DankoDeploy.
Панель подключается к серверу по SSH, делает \`git pull\` в рабочей директории и запускает
docker compose. Никаких агентов на сервере нет. Доставка кода — только через git (commit + push).

Сделай следующее (основной путь — Docker Compose):

1. РЕПОЗИТОРИЙ
   - Убедись, что в КОРНЕ есть \`docker-compose.yml\` (или предложи его создать под текущий стек).
   - Все долгоживущие сервисы должны иметь \`restart: unless-stopped\`.
   - Добавь \`healthcheck\` основным сервисам, где это уместно.
   - Если у сервисов есть БД (Postgres/MySQL/Mongo) — оставь её отдельным сервисом в compose.

2. СЕКРЕТЫ И ОКРУЖЕНИЕ
   - Все секреты/конфиг через переменные окружения из \`.env\`.
   - \`.env\` ДОЛЖЕН быть в \`.gitignore\` (проверь, что он не в истории git; если был — предупреди меня).
   - Создай/обнови \`.env.example\` со всеми переменными без реальных значений.

3. СБОРКА
   - Если образ тяжёлый/сборка долгая — используй multi-stage Dockerfile и slim/alpine базовые образы.
   - Учитывай, что по умолчанию сборка идёт НА СЕРВЕРЕ (\`docker compose up -d --build\`).
     Если сервер слабый — предложи вариант со сборкой в CI и \`docker pull\` из registry.

4. БЭКАП (если есть БД или важные данные)
   - Подскажи готовую команду бэкапа для моей БД в формате DankoDeploy, где \`{{OUT}}\` —
     путь к файлу (его подставит панель). Пример для Postgres:
     \`docker compose exec -T db pg_dump -U postgres <db> | gzip > {{OUT}}\`
     (флаг \`-T\` обязателен — у SSH-сессии нет TTY).

5. ДОКУМЕНТАЦИЯ
   - В \`README\` добавь короткую секцию «Деплой»: что сервис разворачивается через DankoDeploy,
     рабочая директория на сервере — \`/srv/<имя-проекта>\`, перед деплоем нужно запушить код.
   - Перечисли переменные окружения, которые надо создать в \`.env\` на сервере.

ВАЖНЫЕ ОГРАНИЧЕНИЯ (под них и готовь проект):
   - Рабочая директория на сервере обязана быть git-репозиторием (деплой = git pull).
   - Не редактируй файлы прямо на сервере — \`git pull --ff-only\` упадёт при локальных правках.
   - Сервис должен оставаться поднятым (статус берётся из \`docker compose ps\`); one-shot
     контейнеры не подходят как основной сервис.

В конце выведи мне сводку:
   - какой \`kind\` выбрать в панели (docker-compose / systemd / process),
   - значение \`workdir\` (обычно \`/srv/<имя-проекта>\`),
   - имя compose-файла, если оно нестандартное,
   - готовую команду \`backupCommand\` (если применимо),
   - список переменных окружения для \`.env\` на сервере.`;

function PreparePromptCard({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(PREPARE_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="card border-indigo-500/30 bg-indigo-500/5">
      <button className="flex w-full items-center justify-between text-left" onClick={onToggle}>
        <span className="flex items-center gap-2 text-sm font-medium text-indigo-300">
          🤖 Промпт для подготовки проекта к деплою
        </span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-400">
            Скопируй этот промпт и вставь LLM-агенту (Claude Code, Cursor и т.п.) в <b>другом
            репозитории</b> — он приведёт проект к форме, которую панель умеет деплоить.
          </p>
          <div className="relative">
            <button
              className="btn-primary absolute right-2 top-2 px-3 py-1 text-xs"
              onClick={copy}
            >
              {copied ? "Скопировано ✓" : "Копировать"}
            </button>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink p-3 pr-28 text-xs leading-relaxed text-slate-300">
              {PREPARE_PROMPT}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

const emptyProject: CreateProjectInput = {
  name: "",
  kind: "docker-compose",
  stack: "",
  description: "",
  config: { workdir: "" },
};

/** Название → kebab-slug для пути на сервере ("Shop API" → "shop-api"). */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // всё, кроме латиницы/цифр → дефис
    .replace(/^-+|-+$/g, ""); // обрезаем дефисы по краям
}

/** Авто-путь рабочей директории из названия проекта. Пустое имя → пустая строка. */
function srvPath(name: string): string {
  const slug = slugify(name);
  return slug ? `/srv/${slug}` : "";
}

type SourceType = "none" | "git-public" | "git-private";

export function ProjectFormModal({
  project,
  onClose,
  onSaved,
}: {
  /** Если задан — режим редактирования (PATCH), иначе создание. */
  project?: ProjectPublic;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!project;
  const [form, setForm] = useState<CreateProjectInput>(
    project
      ? {
          name: project.name,
          kind: project.kind,
          stack: project.stack ?? "",
          description: project.description ?? "",
          config: project.config,
        }
      : { ...emptyProject },
  );
  // workdir автоформируется из названия (/srv/<slug>), пока пользователь не правил поле вручную.
  // В режиме редактирования путь уже задан — считаем «тронутым», чтобы не перезатереть.
  const [workdirTouched, setWorkdirTouched] = useState(isEdit);
  // Доп. настройки compose-файла свёрнуты по умолчанию; бэкап вынесен в отдельный видимый блок.
  const [showAdvanced, setShowAdvanced] = useState(
    !!project?.config.composeFile,
  );

  // Блок метаинформации свёрнут по умолчанию; раскрываем, если уже что-то заполнено.
  const [showMeta, setShowMeta] = useState(() => {
    const m = project?.config.meta;
    return !!(
      m &&
      (m.ports?.length ||
        m.containers?.length ||
        m.envVars?.length ||
        m.checklist?.length ||
        m.links?.length ||
        m.notes)
    );
  });

  // Источник кода ведём отдельным состоянием, в config.source собираем при сабмите.
  const [sourceType, setSourceType] = useState<SourceType>(project?.config.source?.type ?? "none");
  const [repoUrl, setRepoUrl] = useState(project?.config.source?.repoUrl ?? "");
  const [branch, setBranch] = useState(project?.config.source?.branch ?? "");
  const [gitKeyId, setGitKeyId] = useState(project?.config.source?.gitKeyId ?? "");

  const gitKeys = useQuery({ queryKey: ["git-keys"], queryFn: api.listGitKeys });

  const create = useMutation({ mutationFn: api.createProject, onSuccess: onSaved });
  const update = useMutation({
    mutationFn: (input: CreateProjectInput) => api.updateProject(project!.id, input),
    onSuccess: onSaved,
  });
  const mutation = isEdit ? update : create;

  const setConfig = (patch: Partial<CreateProjectInput["config"]>) =>
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));

  // --- Метаинформация ---
  const meta: ProjectMeta = form.config.meta ?? {};
  const setMeta = (patch: Partial<ProjectMeta>) => setConfig({ meta: { ...meta, ...patch } });

  // --- Артефакты бэкапа ---
  // Текущий список: из backupArtifacts, иначе из legacy backupCommand (обёртка в "default").
  const artifacts: BackupArtifact[] =
    form.config.backupArtifacts ??
    (form.config.backupCommand
      ? [
          {
            name: "default",
            backupCommand: form.config.backupCommand,
            restoreCommand: form.config.restoreCommand,
          },
        ]
      : []);

  // При любом изменении пишем массив в backupArtifacts и убираем legacy-поля.
  const setArtifacts = (next: BackupArtifact[]) =>
    setConfig({ backupArtifacts: next, backupCommand: undefined, restoreCommand: undefined });

  const updateArtifact = (i: number, patch: Partial<BackupArtifact>) =>
    setArtifacts(artifacts.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const addArtifact = () =>
    setArtifacts([
      ...artifacts,
      {
        name: artifacts.length === 0 ? "db" : "media",
        backupCommand: "",
        restoreCommand: "",
      },
    ]);
  const removeArtifact = (i: number) => setArtifacts(artifacts.filter((_, idx) => idx !== i));

  const submit = () => {
    const source =
      sourceType === "none"
        ? undefined
        : {
            type: sourceType,
            repoUrl: repoUrl.trim(),
            branch: branch.trim() || undefined,
            gitKeyId: sourceType === "git-private" ? gitKeyId || undefined : undefined,
          };
    mutation.mutate({ ...form, config: { ...form.config, source } });
  };

  return (
    <Modal title={isEdit ? "Редактировать проект" : "Новый проект"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              // Пока workdir не правили вручную — синхронизируем его с названием.
              setForm((f) => ({
                ...f,
                name,
                config: workdirTouched ? f.config : { ...f.config, workdir: srvPath(name) },
              }));
            }}
            placeholder="shop-api"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Способ раскатки</label>
            <select
              className="input"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as ServiceKind })}
            >
              <option value="docker-compose">Docker Compose</option>
              <option value="systemd">systemd</option>
              <option value="process">Процесс</option>
            </select>
          </div>
          <div>
            <label className="label">Стек</label>
            <input
              className="input"
              value={form.stack ?? ""}
              onChange={(e) => setForm({ ...form, stack: e.target.value })}
              placeholder="Node + Postgres"
            />
          </div>
        </div>

        <div>
          <label className="label">Рабочая директория на сервере</label>
          <input
            className="input"
            value={form.config.workdir}
            onChange={(e) => {
              setWorkdirTouched(true); // дальше не перезаписываем из названия
              setConfig({ workdir: e.target.value });
            }}
            placeholder="/srv/shop-api"
          />
          {!isEdit && !workdirTouched && (
            <p className="mt-1 text-xs text-slate-500">
              Подставляется автоматически из названия. Можно изменить.
            </p>
          )}
        </div>

        {/* Источник кода для первичной раскатки (git clone). */}
        <div className="space-y-2 rounded-lg border border-edge p-3">
          <div>
            <label className="label">Источник кода</label>
            <select
              className="input"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceType)}
            >
              <option value="none">Уже на сервере (не клонировать)</option>
              <option value="git-public">Public git — публичный репозиторий</option>
              <option value="git-private">Private git — приватный (deploy-ключ)</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Панель склонирует репозиторий в рабочую директорию по кнопке «Раскатить». Если код уже
              лежит на сервере — оставьте «не клонировать».
            </p>
          </div>

          {sourceType !== "none" && (
            <>
              <div>
                <label className="label">
                  URL репозитория{" "}
                  {sourceType === "git-private" ? "(ssh: git@host:org/repo.git)" : "(https://…)"}
                </label>
                <input
                  className="input font-mono text-xs"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder={
                    sourceType === "git-private"
                      ? "git@github.com:me/shop-api.git"
                      : "https://github.com/me/shop-api.git"
                  }
                />
                {sourceType === "git-private" && (
                  <p className="mt-1 text-xs text-slate-500">
                    Deploy-ключ применяется только к SSH remote. HTTPS URL запросит логин GitHub и
                    раскатка упадёт.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Ветка (опц.)</label>
                  <input
                    className="input"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                  />
                </div>
                {sourceType === "git-private" && (
                  <div>
                    <label className="label">Git-ключ</label>
                    <select
                      className="input"
                      value={gitKeyId}
                      onChange={(e) => setGitKeyId(e.target.value)}
                    >
                      <option value="">— выберите ключ —</option>
                      {gitKeys.data?.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {sourceType === "git-private" && !gitKeys.data?.length && (
                <p className="text-xs text-amber-400">
                  Нет git-ключей. Создайте пару во вкладке «Git-ключи» и добавьте публичную часть как
                  Deploy key в репозиторий.
                </p>
              )}
            </>
          )}
        </div>

        {form.kind === "systemd" && (
          <div>
            <label className="label">systemd-юнит</label>
            <input
              className="input"
              value={form.config.systemdUnit ?? ""}
              onChange={(e) => setConfig({ systemdUnit: e.target.value })}
              placeholder="shop-api.service"
            />
          </div>
        )}
        {/* Бэкап и restore — видимый блок, потому что от него зависят кнопки в проектах/деплоях. */}
        <div className="space-y-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <label className="label mb-1">Бэкап и восстановление</label>
              <p className="text-xs text-slate-400">
                Добавьте один или несколько артефактов: например{" "}
                <code className="rounded bg-ink px-1">db</code> для базы и{" "}
                <code className="rounded bg-ink px-1">media</code> для файлов. Команда backup должна
                записать файл в <code className="rounded bg-ink px-1">{"{{OUT}}"}</code>, команда restore
                получает файл через <code className="rounded bg-ink px-1">{"{{IN}}"}</code>.
              </p>
            </div>
            <button type="button" className="btn-primary shrink-0 px-3 py-1 text-xs" onClick={addArtifact}>
              + Команды backup/restore
            </button>
          </div>

          {artifacts.length === 0 && (
            <div className="rounded-lg border border-dashed border-edge p-3 text-xs text-slate-500">
              Команды не заданы — кнопка «Сделать бэкап» будет недоступна. Нажмите «Команды
              backup/restore», чтобы добавить первый артефакт.
            </div>
          )}

          {artifacts.map((a, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-edge bg-panel/60 p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="label">Имя артефакта</label>
                  <input
                    className="input font-mono text-xs"
                    value={a.name}
                    onChange={(e) => updateArtifact(i, { name: e.target.value })}
                    placeholder="db / media"
                  />
                </div>
                <button
                  type="button"
                  className="btn-ghost mt-5 px-2 py-1 text-xs text-rose-400"
                  onClick={() => removeArtifact(i)}
                >
                  Удалить
                </button>
              </div>
              <div>
                <label className="label">Backup command</label>
                <input
                  className="input font-mono text-xs"
                  value={a.backupCommand}
                  onChange={(e) => updateArtifact(i, { backupCommand: e.target.value })}
                  placeholder="docker compose exec -T db pg_dump -U postgres app | gzip > {{OUT}}"
                />
              </div>
              <div>
                <label className="label">Restore command</label>
                <input
                  className="input font-mono text-xs"
                  value={a.restoreCommand ?? ""}
                  onChange={(e) => updateArtifact(i, { restoreCommand: e.target.value })}
                  placeholder="gunzip -c {{IN}} | docker compose exec -T db psql -U postgres app"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Restore можно оставить пустым, но тогда этот артефакт нельзя будет восстановить из панели.
                </p>
              </div>
            </div>
          ))}

          <div>
            <label className="label">Cron авто-бэкапа</label>
            <input
              className="input font-mono text-xs"
              value={form.config.backupCron ?? ""}
              onChange={(e) => setConfig({ backupCron: e.target.value })}
              placeholder="0 3 * * *"
            />
          </div>
        </div>

        {/* Дополнительные настройки — нужны редко, по умолчанию свёрнуты. */}
        <div className="rounded-lg border border-edge">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <span>Дополнительно (compose-файл)</span>
            <span className="text-slate-400">{showAdvanced ? "▲" : "▼"}</span>
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t border-edge p-3">
              {form.kind === "docker-compose" && (
                <div>
                  <label className="label">Compose-файл</label>
                  <input
                    className="input"
                    value={form.config.composeFile ?? ""}
                    onChange={(e) => setConfig({ composeFile: e.target.value })}
                    placeholder="docker-compose.prod.yml"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Оставьте пустым для стандартного <code className="rounded bg-ink px-1">docker-compose.yml</code>{" "}
                    — он берётся автоматически. Укажите только нестандартное имя файла.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Метаинформация: справочные заметки для быстрой раскатки */}
        <div className="rounded-lg border border-edge">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300"
            onClick={() => setShowMeta((v) => !v)}
          >
            <span>Метаинформация (порты, контейнеры, env, чек-лист, ссылки)</span>
            <span className="text-slate-400">{showMeta ? "▲" : "▼"}</span>
          </button>

          {showMeta && (
            <div className="space-y-4 border-t border-edge p-3">
              <MetaListEditor
                label="Порты"
                items={meta.ports ?? []}
                onChange={(ports) => setMeta({ ports })}
                empty={{ port: "", description: "" }}
                fields={[
                  { key: "port", placeholder: "80", className: "w-24" },
                  { key: "description", placeholder: "назначение (HTTP, Postgres)" },
                ]}
              />
              <MetaListEditor
                label="Контейнеры / сервисы"
                items={meta.containers ?? []}
                onChange={(containers) => setMeta({ containers })}
                empty={{ name: "", note: "" }}
                fields={[
                  { key: "name", placeholder: "web", className: "w-32" },
                  { key: "note", placeholder: "образ / роль" },
                ]}
              />
              <MetaListEditor
                label="Env-переменные (чек-лист, без значений)"
                items={meta.envVars ?? []}
                onChange={(envVars) => setMeta({ envVars })}
                empty={{ key: "", note: "" }}
                fields={[
                  { key: "key", placeholder: "DATABASE_URL", className: "w-48 font-mono" },
                  { key: "note", placeholder: "комментарий" },
                ]}
              />
              <MetaListEditor
                label="Ссылки (домен, дашборды)"
                items={meta.links ?? []}
                onChange={(links) => setMeta({ links })}
                empty={{ label: "", url: "" }}
                fields={[
                  { key: "label", placeholder: "Прод", className: "w-32" },
                  { key: "url", placeholder: "https://example.com" },
                ]}
              />

              {/* Чек-лист перед раскаткой */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="label mb-0">Чек-лист перед раскаткой</label>
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-xs"
                    onClick={() =>
                      setMeta({ checklist: [...(meta.checklist ?? []), { text: "", done: false }] })
                    }
                  >
                    + Пункт
                  </button>
                </div>
                {(meta.checklist ?? []).map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={(e) =>
                        setMeta({
                          checklist: (meta.checklist ?? []).map((x, idx) =>
                            idx === i ? { ...x, done: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    <input
                      className="input flex-1 text-xs"
                      value={c.text}
                      onChange={(e) =>
                        setMeta({
                          checklist: (meta.checklist ?? []).map((x, idx) =>
                            idx === i ? { ...x, text: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder="Установлен Docker / настроен домен / …"
                    />
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-xs text-rose-400"
                      onClick={() =>
                        setMeta({ checklist: (meta.checklist ?? []).filter((_, idx) => idx !== i) })
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="label">Заметки</label>
                <textarea
                  className="input min-h-[80px] text-xs"
                  value={meta.notes ?? ""}
                  onChange={(e) => setMeta({ notes: e.target.value })}
                  placeholder="Произвольные заметки по проекту (стек, особенности раскатки, …)"
                />
              </div>
            </div>
          )}
        </div>

        {mutation.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(mutation.error).message}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button className="btn-primary" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? <Spinner /> : isEdit ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Универсальный редактор списка однотипных записей (порты/контейнеры/env/ссылки).
 * `fields` описывает текстовые поля записи; добавление/удаление строк встроено.
 */
function MetaListEditor<T extends Record<string, string | undefined>>({
  label,
  items,
  onChange,
  empty,
  fields,
}: {
  label: string;
  items: T[];
  onChange: (next: T[]) => void;
  empty: T;
  fields: { key: keyof T; placeholder: string; className?: string }[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="label mb-0">{label}</label>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => onChange([...items, { ...empty }])}
        >
          + Добавить
        </button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          {fields.map((f) => (
            <input
              key={String(f.key)}
              className={`input text-xs ${f.className ?? "flex-1"}`}
              value={(item[f.key]) ?? ""}
              onChange={(e) =>
                onChange(
                  items.map((x, idx) => (idx === i ? { ...x, [f.key]: e.target.value } : x)),
                )
              }
              placeholder={f.placeholder}
            />
          ))}
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs text-rose-400"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
