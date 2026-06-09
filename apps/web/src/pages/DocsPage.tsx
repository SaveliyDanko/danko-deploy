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

const TRAEFIK_AGENT_SPEC = `Переделай docker-compose этого проекта под общий reverse-proxy Traefik для деплоя через DankoDeploy.

Контекст:
- На VPS работает НЕСКОЛЬКО сайтов. Единый Traefik (отдельный сервис) слушает порты 80 и 443.
  Сами сайты порты наружу НЕ публикуют — Traefik ходит к ним по внутренней docker-сети "web"
  и разводит по доменам. Это убирает конфликт "Bind for 0.0.0.0:80 failed: port is already allocated".
- Сеть "web" уже создана на сервере вручную (docker network create web) и объявляется как external.
- Traefik настроен с certresolver по имени "le" (Let's Encrypt) и entrypoints "web" (:80) и "websecure" (:443),
  http автоматически редиректится на https.
- DankoDeploy раскатывает проект командой docker compose up -d --build в workdir проекта.

Что нужно сделать с docker-compose проекта:
1. Найди веб-сервис(ы), которые сейчас публикуют порты наружу (секция ports: с 80/443/8080 и т.п.).
2. У каждого ТАКОГО сервиса:
   - УБЕРИ секцию ports: целиком (публикация наружу теперь только у Traefik).
   - Подключи сервис к сетям: [web, default] (web — для Traefik, default — для связи внутри проекта).
   - Добавь labels (подставь реальные домен и порт, на котором сервис слушает ВНУТРИ контейнера):
     - traefik.enable=true
     - traefik.docker.network=web
     - traefik.http.routers.<ROUTER>.rule=Host(\`example.com\`)
     - traefik.http.routers.<ROUTER>.entrypoints=websecure
     - traefik.http.routers.<ROUTER>.tls.certresolver=le
     - traefik.http.services.<ROUTER>.loadbalancer.server.port=<ВНУТРЕННИЙ_ПОРТ>
   - <ROUTER> — короткое уникальное имя (латиница), напр. имя сайта. Должно быть уникальным на всём VPS.
   - traefik.docker.network=web обязателен, потому что сервис подключён сразу к двум сетям, и Traefik должен явно брать IP контейнера из общей external-сети "web", а не из project default network.
3. Сервисы БЕЗ внешнего доступа (БД, redis, воркеры) не трогай — они и так общаются по сети проекта.
4. Внизу файла добавь объявление внешней сети:
     networks:
       web:
         external: true
5. Определи ВНУТРЕННИЙ порт сервиса по Dockerfile/конфигу (EXPOSE, порт nginx/приложения) — это порт
   ВНУТРИ контейнера, НЕ хостовый. Если в исходном ports было "80:80" — внутренний порт 80; "8080:3000" — 3000.
6. Не добавляй сам Traefik в этот compose — он живёт отдельным проектом.
7. Проверь healthcheck публичного web-сервиса:
   - Traefik может игнорировать контейнеры со статусом unhealthy/starting, из-за чего будет отдавать 404 и TRAEFIK DEFAULT CERT даже при правильных labels.
   - Если healthcheck обращается к localhost, замени localhost на 127.0.0.1:
       http://localhost/ -> http://127.0.0.1/
       http://localhost:3000/ -> http://127.0.0.1:3000/
   - Причина: внутри Alpine/nginx/busybox wget localhost может резолвиться в IPv6 [::1], а приложение/nginx часто слушает только IPv4. Тогда healthcheck падает с "Connection refused", контейнер становится unhealthy, и Traefik не создаёт рабочий router.
   - Если healthcheck задан и в docker-compose.yml, и в Dockerfile, приведи оба к 127.0.0.1.
   - Не удаляй healthcheck без необходимости; лучше исправь его так, чтобы он проверял внутренний порт сервиса по IPv4 loopback.

Важные правила:
- НЕ хардкодь IP/хостовые порты. Маршрутизация только по домену через Host(...).
- Несколько доменов на сервис: Host(\`a.com\`) || Host(\`www.a.com\`).
- Если у проекта несколько публичных сервисов (frontend + api на поддомене) — у каждого свой router и Host.
- Сохрани остальную конфигурацию (volumes, env, depends_on) без изменений.
- Healthcheck сохраняй по смыслу, но адаптируй URL под внутренний порт и IPv4 loopback: используй 127.0.0.1 вместо localhost, чтобы контейнер не стал unhealthy из-за IPv6 localhost.
- Если меняешь healthcheck в compose, проверь, нет ли аналогичного HEALTHCHECK в Dockerfile. Если есть — обнови и его.
- После изменений проверь итоговый compose через docker compose config, подставив временные значения обязательных env-переменных, если нужно.

Формат ответа:

## Изменённый docker-compose.yml
\`\`\`yaml
<полный итоговый файл>
\`\`\`

## Что изменилось
- какие ports убраны;
- какие Traefik labels добавлены;
- какой внутренний порт определён и почему;
- какой healthcheck изменён и почему;
- был ли обновлён HEALTHCHECK в Dockerfile.

## Чек-лист перед деплоем
- A-запись домена указывает на IP сервера.
- На сервере выполнено: docker network create web (один раз).
- Traefik-проект уже задеплоен и слушает 80/443.
- Traefik-контейнер подключён к external-сети web. Проверка:
    docker network inspect web
  В списке Containers должны быть и Traefik, и web-контейнер сайта.
- В compose Traefik-проекта закреплено:
    networks:
      - web
  и:
    networks:
      web:
        external: true
- Желательно, чтобы Traefik Docker provider был закреплён на сеть web:
    --providers.docker.network=web
- После деплоя проверь:
    docker compose ps
  Публичный web-сервис должен быть healthy. Если он unhealthy, Traefik может отдавать 404/default cert.
- Если Traefik отдаёт HTTP 404 и TRAEFIK DEFAULT CERT:
  1. Проверь labels контейнера:
       docker inspect <web-container> --format '{{range \$k,\$v := .Config.Labels}}{{println \$k "=" \$v}}{{end}}'
  2. Проверь, что есть:
       traefik.docker.network=web
  3. Проверь healthcheck:
       docker inspect <web-container> --format '{{range .State.Health.Log}}{{println .Output}}{{end}}'
  4. Проверь, что Traefik и сайт в одной сети:
       docker network inspect web
- ВНИМАНИЕ для серверов с включённым VPN-клиентом: выпуск Let's Encrypt по HTTP-01 может зависнуть
  (входящий на 80 и ответ должны идти мимо VPN-туннеля). Если так — предложи переключить Traefik
  на DNS-01 challenge у DNS-провайдера домена.
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
        <InfoCard title="Доступ к серверу не оборвётся">
          Весь исходящий трафик уходит в туннель, КРОМЕ ответов на входящие подключения — они
          исключаются на уровне ядра (policy routing в отдельную таблицу на физический шлюз) ещё до
          старта sing-box. Это покрывает SSH-доступ панели, а также ваши сайты на сервере, поэтому
          управление и сайты остаются доступны по IP сервера.
        </InfoCard>
        <InfoCard title="Сайты за Traefik/docker и VPN">
          Раньше после включения VPN сайты переставали открываться: ответ контейнера (Traefik, сайт)
          уходил в туннель с IP VPN-провайдера. Теперь страховка заворачивает мимо туннеля и ответы
          docker-контейнеров — по их адресу в docker-сети (172.x), т.к. подмена на внешний IP
          (MASQUERADE) происходит позже. Сайты на 80/443 работают при включённом VPN.
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

      <AgentPromptBlock
        prompt={BACKUP_RESTORE_AGENT_SPEC}
        description={
          <>
            Не хотите составлять команды вручную? Скопируйте этот промт и отправьте его LLM-агенту
            (Claude Code, Codex и т.п.) в репозитории вашего проекта. Агент изучит проект, определит,
            что бэкапить (БД / media / volumes), и вернёт готовые{" "}
            <code className="rounded bg-ink px-1">backupArtifacts</code> с командами backup/restore,
            которые останется вставить в форму проекта DankoDeploy.
          </>
        }
      />
    </section>
  );
}

/**
 * Готовый промт для LLM-агента: отправьте его в репозиторий проекта, агент изучит код
 * и вернёт готовый результат под формат DankoDeploy. Параметризован, чтобы один блок
 * переиспользовался для разных промтов (backup/restore, Traefik и т.п.).
 */
function AgentPromptBlock({
  prompt,
  description,
}: {
  prompt: string;
  description: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="card space-y-3 border-indigo-500/30 bg-indigo-500/5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <span aria-hidden>🤖</span> Промт для LLM-агента
        </h3>
        <button className="btn-primary px-3 py-1 text-xs" onClick={copy}>
          {copied ? "Скопировано" : "Скопировать промт"}
        </button>
      </div>
      <p className="text-sm text-slate-400">{description}</p>
      <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink p-3 text-xs leading-relaxed text-slate-300">
        {prompt}
      </pre>
    </div>
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
  return (
    <section id="agent-spec" className="scroll-mt-20 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Спецификации для LLM-агента
      </h2>
      <p className="text-sm text-slate-400">
        Готовые промты для других LLM-агентов: скопируйте нужный и отправьте агенту в репозитории
        вашего проекта — он подготовит проект под DankoDeploy и вернёт готовый результат.
      </p>

      <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Backup / Restore
      </h3>
      <AgentPromptBlock
        prompt={BACKUP_RESTORE_AGENT_SPEC}
        description={
          <>
            Агент изучит проект, определит, что бэкапить (БД / media / volumes), и вернёт готовые{" "}
            <code className="rounded bg-ink px-1">backupArtifacts</code> с командами backup/restore
            для формы проекта DankoDeploy.
          </>
        }
      />

      <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Traefik (несколько сайтов на VPS)
      </h3>
      <AgentPromptBlock
        prompt={TRAEFIK_AGENT_SPEC}
        description={
          <>
            Агент переделает <code className="rounded bg-ink px-1">docker-compose</code> проекта под
            общий reverse-proxy Traefik: уберёт публикацию портов, подключит сервис к сети{" "}
            <code className="rounded bg-ink px-1">web</code> и навесит метки с доменом и HTTPS. Так
            несколько сайтов уживаются на одном VPS без конфликта портов 80/443.
          </>
        }
      />
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
