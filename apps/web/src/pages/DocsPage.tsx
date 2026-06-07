/* Экранирование в строках-примерах намеренное: показываем пользователю
   НЕПРАВИЛЬНО переэкранированный shell как анти-пример. Поэтому no-useless-escape выключен. */
/* eslint-disable no-useless-escape */
import { useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";

const BACKUP_RESTORE_AGENT_SPEC = `Подготовь backup/restore команды для проекта под DankoDeploy.

Контекст:
- DankoDeploy запускает команды по SSH в рабочей директории проекта: workdir.
- Бэкап настраивается списком артефактов: db, media, uploads и т.п.
- Для каждого артефакта нужны:
  - name: короткое имя артефакта, например db или media
  - backupCommand: shell-команда, которая записывает результат в файл {{OUT}}
  - restoreCommand: shell-команда, которая восстанавливает данные из файла {{IN}}
- {{OUT}} и {{IN}} подставляет панель. Не заменяй их реальными путями.
- Команды должны быть неинтерактивными и пригодными для запуска по SSH без TTY.
- Если используешь docker compose exec, обязательно добавляй -T.
- Команда backup должна завершаться с ненулевым кодом при ошибке.
- Команда restore может перезаписать данные, поэтому добавь предупреждения и порядок действий.
- Если готовишь команды для вставки в UI-поле DankoDeploy, НЕ используй YAML-экранирование shell-кавычек.
  Правильно для UI: IN={{IN}}; IN="\${IN//\\"/}"
  Неправильно для UI: IN=\\\"\${IN//\\\\\\\"/}\\\"
- Если готовишь YAML-фрагмент, отдельно поясни, что при ручной вставке в UI нужно снять YAML-экранирование.
- Для Docker volumes не хардкодь host path. Если данные живут в контейнере, найди реальный host path через docker inspect по .Mounts Destination.
- Restore должен проверять результат: test -s для входного файла, размер SQLite/дампа, наличие файлов после распаковки, API/DB smoke-check.

Что нужно сделать:
1. Определи, какие данные проекта нужно бэкапить: база данных, uploads/media, sqlite-файл, storage.
2. Предложи список артефактов DankoDeploy.
3. Для каждого артефакта дай backupCommand и restoreCommand.
4. Укажи, нужно ли остановить сервис перед restore и запустить после.
5. Укажи переменные окружения, имена контейнеров и имена БД, которые нужно проверить.
6. Проверь, где реально находятся Docker mounts для БД/uploads/media.
7. Дай короткий гайд проверки: как сделать тестовый backup и безопасный restore на staging.

Формат ответа:

## DankoDeploy backupArtifacts

\`\`\`yaml
backupArtifacts:
  - name: db
    backupCommand: "..."
    restoreCommand: "..."
  - name: media
    backupCommand: "..."
    restoreCommand: "..."
backupCron: "0 3 * * *"
\`\`\`

## Что проверить перед вставкой в панель
- ...
- Если ответ дан в YAML, перепиши команды в raw shell-вид для UI без лишних \\".
- Для {{IN}} допускается нормализация: IN={{IN}}; IN="\${IN//\\"/}".
- Не вставляй в UI фрагменты вида IN=\\\"\${IN//\\\\\\\"/}\\\" — это создаёт кавычки внутри имени файла.

## Тестовый сценарий
- ...
`;

const postgresExample = `# backup db
docker compose exec -T db pg_dump -U postgres app | gzip > {{OUT}}

# restore db
gunzip -c {{IN}} | docker compose exec -T db psql -U postgres app`;

const mysqlExample = `# backup db
docker compose exec -T db mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" app | gzip > {{OUT}}

# restore db
gunzip -c {{IN}} | docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" app`;

const sqliteExample = `# backup sqlite
sqlite3 ./data/app.sqlite ".backup '{{OUT}}'"

# restore sqlite
cp {{IN}} ./data/app.sqlite`;

const mediaExample = `# backup media
tar czf {{OUT}} -C /srv/myapp media uploads

# restore media
tar xzf {{IN}} -C /srv/myapp`;

function VpnSection() {
  return (
    <section id="vpn" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">VPN</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <InfoCard title="VPN (сервер) — Outline">
          Разворачивает на вашем VPS Outline Server (Shadowsocks): сервер становится VPN-сервером и
          раздаёт доступ. Раскатка по SSH, management-токен хранится зашифрованным.
        </InfoCard>
        <InfoCard title="VPN-клиент — sing-box">
          Наоборот: VPS подключается КЛИЕНТОМ к вашему VPN-провайдеру по subscription-ссылке (той же,
          что в Happ/Hiddify) и гонит весь свой трафик через провайдера. Движок — sing-box (TUN).
        </InfoCard>
        <InfoCard title="Как включить VPN-клиент">
          Выберите сервер → вставьте subscription-ссылку → «Загрузить локации» → выберите локацию →
          «Включить VPN». Панель сама парсит подписку и пишет конфиг sing-box на сервер.
        </InfoCard>
        <InfoCard title="SSH не оборвётся">
          Весь исходящий трафик уходит в туннель, КРОМЕ SSH-доступа панели — он исключается на уровне
          ядра (fwmark + ip rule) ещё до старта sing-box, поэтому управление сервером не теряется.
        </InfoCard>
        <InfoCard title="Требования к серверу">
          Нужны root/sudo, systemd и доступный /dev/net/tun. На OpenVZ/LXC TUN часто запрещён —
          readiness-чек это покажет до установки. Кнопка «Проверить готовность» проверяет всё разом.
        </InfoCard>
        <InfoCard title="Проверка и обновление">
          Кнопка «Проверить IP» показывает внешний IP сервера: если он отличается от host — трафик
          идёт через VPN. Подписка обновляется автоматически (cron), список серверов матчится по локации.
        </InfoCard>
      </div>
    </section>
  );
}

/** Разделы документации: slug в URL → подпись таба → компонент раздела. */
const DOCS_SECTIONS = [
  { slug: "overview", label: "Обзор", Component: OverviewSection },
  { slug: "entities", label: "Сущности", Component: EntitiesSection },
  { slug: "workflow", label: "Workflow", Component: WorkflowSection },
  { slug: "backup-restore", label: "Backup/Restore", Component: BackupRestoreSection },
  { slug: "vpn", label: "VPN", Component: VpnSection },
  { slug: "pitfalls", label: "Ошибки", Component: PitfallsSection },
  { slug: "examples", label: "Примеры", Component: ExamplesSection },
  { slug: "agent-spec", label: "LLM-спека", Component: AgentPromptSection },
] as const;

/**
 * Layout документации: шапка + табы-ссылки (каждый раздел — свой URL /docs/<slug>)
 * и <Outlet/>, куда рендерится выбранный раздел через DocsSectionPage.
 */
export function DocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Docs</h1>
        <p className="mt-1 text-sm text-slate-400">
          Краткая документация по DankoDeploy и спецификация команд backup/restore для подготовки
          проектов.
        </p>
      </div>

      <nav className="sticky top-0 z-10 flex flex-wrap gap-2 border-b border-edge bg-ink/95 py-3 backdrop-blur">
        {DOCS_SECTIONS.map(({ slug, label }) => (
          <NavLink
            key={slug}
            to={`/docs/${slug}`}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1 text-xs font-medium transition ${
                isActive ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-edge"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}

/** Рендерит один раздел документации по :section из URL. */
export function DocsSectionPage() {
  const { section } = useParams();
  const entry = DOCS_SECTIONS.find((s) => s.slug === section);
  if (!entry) {
    return (
      <div className="card text-sm text-slate-400">
        Раздел не найден. Выберите раздел в навигации выше.
      </div>
    );
  }
  const { Component } = entry;
  return <Component />;
}

function OverviewSection() {
  return (
    <section id="overview" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Обзор
      </h2>
      <div className="card space-y-3 text-sm text-slate-300">
        <p>
          <b>DankoDeploy</b> управляет VPS по SSH: создаёт деплои, выполняет раскатку, снимает
          бэкапы, восстанавливает данные, пишет <code className="rounded bg-ink px-1">.env</code> на
          сервер и открывает веб-терминал.
        </p>
        <p>
          Панель запускается локально и не требует агента на сервере. Все действия идут через SSH, а
          live-логи операций показываются в боковом окне.
        </p>
      </div>
    </section>
  );
}

function EntitiesSection() {
  return (
    <section id="entities" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Сущности</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="Проект">
          Карточка сервиса: тип, рабочая директория, источник git, команды backup/restore и
          справочная метаинформация.
        </InfoCard>
        <InfoCard title="Сервер">
          VPS-подключение: host, порт, пользователь и способ SSH-аутентификации. Обслуживание
          сервера выполняется со страницы конкретного сервера.
        </InfoCard>
        <InfoCard title="Деплой">
          Связка проект + сервер. Именно на деплой запускаются Deploy, Undeploy, Backup, Restore и
          запись .env.
        </InfoCard>
        <InfoCard title="Бэкап">
          История хранится на проекте, но каждый backup снимается с конкретного деплоя и может быть
          восстановлен на выбранный деплой.
        </InfoCard>
        <InfoCard title="SSH-ключ">
          Ключ доступа к серверу. Приватная часть хранится в зашифрованном виде и не показывается в
          публичных ответах API.
        </InfoCard>
        <InfoCard title="Git-ключ">
          Deploy key для приватных git-репозиториев. Используется при раскатке проекта из private
          repository.
        </InfoCard>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section id="workflow" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Workflow</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <InfoCard title="1. Добавьте сервер">
          В разделе «Серверы» создайте подключение, проверьте SSH и при необходимости установите
          Docker или Node/npm со страницы конкретного сервера.
        </InfoCard>
        <InfoCard title="2. Создайте проект">
          Укажите тип сервиса, рабочую директорию, git-источник, команды deploy/undeploy и
          backup/restore артефакты.
        </InfoCard>
        <InfoCard title="3. Создайте деплой">
          В разделе «Деплои» свяжите проект с сервером. Один проект можно связать с несколькими
          серверами.
        </InfoCard>
        <InfoCard title="4. Запускайте операции">
          Раскатка, деплой, backup и restore открывают боковое окно с live-логом и статусом
          выполнения.
        </InfoCard>
      </div>
    </section>
  );
}

function BackupRestoreSection() {
  return (
    <section id="backup-restore" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Спецификация backup/restore
      </h2>
      <div className="card space-y-4 text-sm text-slate-300">
        <div className="space-y-2">
          <p>
            Команды задаются в проекте: <b>Проекты → проект → Изменить → Бэкап и восстановление</b>.
            Один артефакт — это одна пара команд. Например, отдельно{" "}
            <code className="rounded bg-ink px-1">db</code> и{" "}
            <code className="rounded bg-ink px-1">media</code>.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-slate-400">
            <li>
              <code className="rounded bg-ink px-1">{"{{OUT}}"}</code> — путь к файлу, куда команда
              backup должна записать результат.
            </li>
            <li>
              <code className="rounded bg-ink px-1">{"{{IN}}"}</code> — путь к файлу, из которого
              команда restore должна восстановить данные.
            </li>
            <li>
              Команды выполняются по SSH в <code className="rounded bg-ink px-1">workdir</code>{" "}
              проекта.
            </li>
            <li>
              Для <code className="rounded bg-ink px-1">docker compose exec</code> нужен флаг{" "}
              <code className="rounded bg-ink px-1">-T</code>, потому что SSH-запуск без TTY.
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          Restore перезаписывает данные. Для production сначала проверьте команды на staging или на
          временной копии данных.
        </div>
      </div>
    </section>
  );
}

function PitfallsSection() {
  return (
    <section id="pitfalls" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Частые ошибки backup/restore
      </h2>
      <div className="card space-y-4 text-sm text-slate-300">
        <InfoCard title="YAML-экранирование в UI">
          Если команда вставляется прямо в поле DankoDeploy, это обычный shell, не YAML. Не нужно
          экранировать кавычки как <code className="rounded bg-ink px-1">\"</code>. Иначе путь{" "}
          <code className="rounded bg-ink px-1">{"{{IN}}"}</code> может стать строкой с кавычками
          внутри имени файла.
        </InfoCard>

        <div className="grid gap-3 md:grid-cols-2">
          <CodeExample title="Правильно для UI">{`IN={{IN}}; IN="\${IN//\\"/}"
test -s "$IN"`}</CodeExample>
          <CodeExample title="Неправильно для UI">{`IN=\\\"\${IN//\\\\\\\"/}\\\"
test -s "$IN"`}</CodeExample>
        </div>

        <InfoCard title="Docker volume path">
          Не хардкодьте host-путь вроде <code className="rounded bg-ink px-1">/opt/app/uploads</code>.
          Для контейнерных данных берите реальный mount через{" "}
          <code className="rounded bg-ink px-1">docker inspect</code> по нужному{" "}
          <code className="rounded bg-ink px-1">.Destination</code>.
        </InfoCard>

        <CodeExample title="Найти host path mount">{`DB_DIR=$(docker inspect app-backend --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')
UPLOADS_DIR=$(docker inspect app-backend --format '{{range .Mounts}}{{if eq .Destination "/uploads"}}{{.Source}}{{end}}{{end}}')`}</CodeExample>

        <InfoCard title="Успешный exit code не равен успешным данным">
          Restore-команда должна сама проверять результат: входной файл существует и не пустой,
          SQLite-файл стал ожидаемого размера, файлы реально появились в uploads, API или DB
          smoke-check возвращает данные. Иначе команда может завершиться с кодом 0, но приложение
          продолжит читать пустую БД или другую директорию.
        </InfoCard>
      </div>
    </section>
  );
}

function ExamplesSection() {
  return (
    <section id="examples" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Примеры команд
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <CodeExample title="Postgres">{postgresExample}</CodeExample>
        <CodeExample title="MySQL">{mysqlExample}</CodeExample>
        <CodeExample title="SQLite">{sqliteExample}</CodeExample>
        <CodeExample title="Media/uploads">{mediaExample}</CodeExample>
      </div>
    </section>
  );
}

function AgentPromptSection() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(BACKUP_RESTORE_AGENT_SPEC);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section id="agent-spec" className="scroll-mt-20 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Спецификация для LLM-агента
        </h2>
        <button className="btn-primary px-3 py-1 text-xs" onClick={copy}>
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>
      <div className="card space-y-3">
        <p className="text-sm text-slate-400">
          Отправьте этот текст агенту в другом репозитории. Он должен вернуть готовые команды и гайд,
          который можно перенести в форму проекта DankoDeploy.
        </p>
        <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink p-3 text-xs leading-relaxed text-slate-300">
          {BACKUP_RESTORE_AGENT_SPEC}
        </pre>
      </div>
    </section>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-ink/40 p-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="text-sm text-slate-300">{children}</div>
    </div>
  );
}

function CodeExample({ title, children }: { title: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="rounded-lg border border-edge bg-ink/40">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={copy}>
          {copied ? "OK" : "Копировать"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-slate-300">{children}</pre>
    </div>
  );
}
