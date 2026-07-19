import type { ReactNode, SVGProps } from "react";
import { Link } from "react-router-dom";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const icons = {
  arrow: (
    <Icon className="h-4 w-4">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  ),
  backup: (
    <Icon className="h-5 w-5">
      <path d="M4 7v13h16V7l-3-3H7L4 7Z" />
      <path d="M8 4v6h8V4M8 16h8" />
    </Icon>
  ),
  bolt: (
    <Icon className="h-5 w-5">
      <path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z" />
    </Icon>
  ),
  check: (
    <Icon className="h-4 w-4">
      <path d="m5 12 4 4L19 6" />
    </Icon>
  ),
  code: (
    <Icon className="h-5 w-5">
      <path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />
    </Icon>
  ),
  deploy: (
    <Icon className="h-5 w-5">
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 14v5h14v-5" />
    </Icon>
  ),
  github: (
    <Icon className="h-4 w-4">
      <path d="M9 19c-4.3 1.4-4.3-2.4-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.7-1.4 5.7-6.2A4.8 4.8 0 0 0 19 6c.1-.3.6-1.6-.1-3.2 0 0-1-.3-3.4 1.3a11.7 11.7 0 0 0-6 0C7.1 2.5 6 2.8 6 2.8 5.4 4.4 5.8 5.7 6 6a4.8 4.8 0 0 0-1.3 3.3c0 4.8 3 5.9 5.7 6.2-.4.4-.7 1-.7 2V21" />
    </Icon>
  ),
  key: (
    <Icon className="h-5 w-5">
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M15 8l3 3M17 6l2 2" />
    </Icon>
  ),
  monitor: (
    <Icon className="h-5 w-5">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="m7 13 3-3 3 2 4-5M8 21h8M12 17v4" />
    </Icon>
  ),
  server: (
    <Icon className="h-5 w-5">
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </Icon>
  ),
  shield: (
    <Icon className="h-5 w-5">
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  terminal: (
    <Icon className="h-5 w-5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </Icon>
  ),
};

const features = [
  {
    icon: icons.deploy,
    title: "Деплой по кнопке",
    text: "Git pull, Docker Compose, systemd или собственный сценарий — с живым логом каждого шага.",
    accent: "indigo",
  },
  {
    icon: icons.monitor,
    title: "Мониторинг",
    text: "CPU, память, диски, контейнеры и открытые порты серверов в одном спокойном интерфейсе.",
    accent: "cyan",
  },
  {
    icon: icons.backup,
    title: "Бэкапы по расписанию",
    text: "Ручные и cron-бэкапы, история запусков, скачивание и восстановление артефактов.",
    accent: "emerald",
  },
  {
    icon: icons.terminal,
    title: "Терминал в браузере",
    text: "Полноценный SSH shell с телефона или компьютера — без переключения между приложениями.",
    accent: "violet",
  },
  {
    icon: icons.code,
    title: "AI-агенты",
    text: "Разворачивайте Codex и Claude Code в tmux и возвращайтесь к той же сессии с любого устройства.",
    accent: "amber",
  },
  {
    icon: icons.key,
    title: "SSH-ключи",
    text: "Генерация, импорт и доставка ключей. Приватные данные зашифрованы до записи в базу.",
    accent: "rose",
  },
];

const steps = [
  ["01", "Подключите сервер", "Добавьте VPS по SSH или выберите локальный хост."],
  ["02", "Создайте проект", "Укажите репозиторий, рабочую директорию и сценарий запуска."],
  ["03", "Нажмите Deploy", "Следите за процессом в live-логе и управляйте сервисом из панели."],
];

function ProductPreview() {
  return (
    <div
      className="landing-preview relative mx-auto w-full max-w-2xl"
      aria-label="Пример интерфейса DankoDeploy"
    >
      <div className="absolute -left-12 top-16 h-52 w-52 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="absolute -right-8 bottom-4 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0c111b] shadow-2xl shadow-indigo-950/50">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-3 text-[10px] text-slate-500">dankodeploy / dashboard</span>
        </div>
        <div className="flex min-h-[350px]">
          <aside className="hidden w-36 shrink-0 border-r border-white/[0.06] p-3 sm:block">
            <div className="mb-5 flex items-center gap-2 text-[11px] font-semibold text-indigo-300">
              <span className="grid h-5 w-5 place-items-center rounded-md bg-indigo-500/20">ϟ</span>
              DankoDeploy
            </div>
            {[
              ["Обзор", true],
              ["Проекты", false],
              ["Серверы", false],
              ["Бэкапы", false],
              ["AI-агенты", false],
            ].map(([label, active]) => (
              <div
                key={String(label)}
                className={`mb-1 rounded-md px-2 py-1.5 text-[9px] ${active ? "bg-indigo-500/15 text-indigo-300" : "text-slate-500"}`}
              >
                {label}
              </div>
            ))}
          </aside>
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">
                  Инфраструктура
                </p>
                <h3 className="mt-1 text-sm font-semibold text-white">Добрый вечер, Алексей</h3>
              </div>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[8px] text-emerald-300">
                ● 3 сервера online
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["CPU", "24%", "w-1/4", "bg-indigo-400"],
                ["RAM", "6.4 GB", "w-3/5", "bg-cyan-400"],
                ["Deploys", "18", "w-4/5", "bg-emerald-400"],
              ].map(([label, value, width, color]) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"
                >
                  <p className="text-[8px] text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className={`h-full ${width} ${color}`} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-medium text-slate-300">Активные проекты</span>
                <span className="text-[8px] text-indigo-300">Смотреть все →</span>
              </div>
              {[
                ["danko-api", "Production", "2 мин назад"],
                ["portfolio-web", "Production", "1 день назад"],
                ["telegram-bot", "Staging", "3 дня назад"],
              ].map(([name, environment, time]) => (
                <div
                  key={name}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-white/[0.05] py-2 text-[8px]"
                >
                  <span className="font-medium text-slate-300">{name}</span>
                  <span className="text-slate-500">{environment}</span>
                  <span className="flex items-center gap-1 text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {time}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-indigo-400/10 bg-indigo-400/[0.04] px-3 py-2 font-mono text-[8px] text-slate-400">
              <span className="text-emerald-300">✓</span> deploy completed · docker compose up -d
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="landing-page min-h-screen overflow-hidden bg-[#070a10] text-slate-200">
      <header className="relative z-20 border-b border-white/[0.06] bg-[#070a10]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-5 sm:px-8">
          <a
            href="#top"
            className="flex items-center gap-2.5 font-semibold tracking-tight text-white"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500 text-lg shadow-lg shadow-indigo-500/25">
              ϟ
            </span>
            Danko Deploy
          </a>
          <nav className="ml-auto hidden items-center gap-7 text-sm text-slate-400 md:flex">
            <a className="transition hover:text-white" href="#features">
              Возможности
            </a>
            <a className="transition hover:text-white" href="#workflow">
              Как работает
            </a>
            <a className="transition hover:text-white" href="#security">
              Безопасность
            </a>
          </nav>
          <Link
            className="ml-auto rounded-lg border border-white/10 px-3.5 py-2 text-sm font-medium text-white transition hover:border-indigo-400/40 hover:bg-white/5 md:ml-8"
            to="/"
          >
            Открыть панель
          </Link>
        </div>
      </header>

      <main id="top">
        <section className="relative px-5 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28">
          <div className="landing-grid absolute inset-0 opacity-40" />
          <div className="absolute left-1/2 top-[-220px] h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[100px]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-[0.88fr_1.12fr]">
            <div className="max-w-xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/[0.07] px-3 py-1.5 text-xs font-medium text-indigo-300">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shadow-[0_0_12px_#818cf8]" />
                Open-source · Self-hosted · Agentless
              </div>
              <h1 className="text-5xl font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
                Деплой без
                <br />
                <span className="landing-gradient-text">лишнего шума.</span>
              </h1>
              <p className="mt-7 max-w-lg text-base leading-7 text-slate-400 sm:text-lg">
                Управляйте серверами, проектами и бэкапами из одной локальной панели. Всё работает
                через SSH — без агентов и сложной инфраструктуры.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:bg-indigo-400"
                >
                  Открыть панель {icons.arrow}
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  {icons.github} Посмотреть возможности
                </a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
                {["Один Docker Compose", "Ваши данные — у вас", "MIT License"].map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <span className="text-emerald-400">✓</span>
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="border-y border-white/[0.06] bg-white/[0.015] px-5 py-7 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-12 gap-y-5 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            <span className="text-slate-600">Работает с</span>
            <span>Docker Compose</span>
            <span>Systemd</span>
            <span>Node.js</span>
            <span>SSH</span>
            <span>SQLite</span>
          </div>
        </section>

        <section id="features" className="px-5 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
                Всё необходимое
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">
                Контроль над инфраструктурой.
                <br />
                <span className="text-slate-500">Без DevOps-команды.</span>
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-400">
                От первого подключения к VPS до ежедневного мониторинга — все привычные задачи
                собраны в одном месте.
              </p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className="group bg-[#0a0e16] p-7 transition hover:bg-[#0d121d] sm:p-8"
                >
                  <div className={`feature-icon feature-icon-${feature.accent}`}>
                    {feature.icon}
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-white">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="workflow"
          className="border-y border-white/[0.06] bg-[#090d15] px-5 py-24 sm:px-8 sm:py-32"
        >
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-16 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
                  Просто начать
                </p>
                <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">
                  От пустого VPS
                  <br />
                  до релиза за минуты.
                </h2>
                <p className="mt-5 max-w-md text-base leading-7 text-slate-400">
                  DankoDeploy не требует отдельного агента на каждом сервере. Достаточно обычного
                  SSH-доступа.
                </p>
              </div>
              <div>
                {steps.map(([number, title, text], index) => (
                  <div
                    key={number}
                    className="relative grid grid-cols-[48px_1fr] gap-5 pb-10 last:pb-0"
                  >
                    {index < steps.length - 1 && (
                      <div className="absolute left-[23px] top-12 h-[calc(100%-2rem)] w-px bg-gradient-to-b from-indigo-400/40 to-transparent" />
                    )}
                    <div className="relative z-10 grid h-12 w-12 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-400/[0.08] font-mono text-xs text-indigo-300">
                      {number}
                    </div>
                    <div className="pt-1">
                      <h3 className="text-lg font-semibold text-white">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="security" className="px-5 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-2">
            <div className="relative order-2 lg:order-1">
              <div className="absolute inset-0 bg-emerald-500/10 blur-3xl" />
              <div className="relative rounded-2xl border border-white/[0.08] bg-[#0a0f17] p-6 sm:p-8">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-5">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
                      {icons.shield}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Security status</p>
                      <p className="text-xs text-slate-500">Все системы защищены</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                    Secure
                  </span>
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    "AES-256-GCM шифрование секретов",
                    "TOFU-проверка ключа SSH-хоста",
                    "HttpOnly-сессии с ограниченным TTL",
                    "Панель слушает только localhost",
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-sm text-slate-300"
                    >
                      <span className="text-emerald-400">{icons.check}</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                Security by default
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">
                Ваша инфраструктура
                <br />
                остаётся вашей.
              </h2>
              <p className="mt-6 max-w-lg text-base leading-7 text-slate-400">
                Панель работает локально, не отправляет данные в облако и шифрует SSH-секреты до
                записи в SQLite. Никаких внешних аккаунтов и скрытой телеметрии.
              </p>
              <div className="mt-7 flex items-start gap-3 text-sm text-slate-300">
                <span className="mt-0.5 text-indigo-300">{icons.server}</span>
                <p>
                  <strong className="font-medium text-white">Без агентов на VPS.</strong>
                  <br />
                  <span className="text-slate-500">
                    Только стандартный SSH и обычные shell-команды.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-8 sm:pb-32">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl border border-indigo-400/20 bg-indigo-500/[0.08] px-6 py-16 text-center sm:px-12 sm:py-20">
            <div className="landing-grid absolute inset-0 opacity-30" />
            <div className="absolute left-1/2 top-0 h-64 w-2/3 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="relative">
              <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl bg-indigo-500 text-white shadow-xl shadow-indigo-500/25">
                {icons.bolt}
              </div>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">
                Ваши серверы. Одна панель.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-slate-400">
                Разворачивайте проекты, следите за инфраструктурой и сохраняйте контроль над
                данными.
              </p>
              <Link
                to="/"
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-indigo-50"
              >
                Перейти в DankoDeploy {icons.arrow}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-xs text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2 font-medium text-slate-300">
            <span className="text-indigo-400">ϟ</span>Danko Deploy
          </div>
          <p>Self-hosted deployment panel · Open source</p>
          <a className="transition hover:text-slate-300" href="#top">
            Наверх ↑
          </a>
        </div>
      </footer>
    </div>
  );
}
