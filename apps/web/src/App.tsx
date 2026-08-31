import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { DeployDrawer } from "./components/DeployDrawer.js";
import { api } from "./lib/api.js";
import {
  closeDeployLogDrawer,
  getDeployLogDrawerState,
  subscribeDeployLogDrawer,
  type DeployLogDrawerState,
} from "./lib/deployLogDrawer.js";

type NavSection =
  | "dashboard"
  | "projects"
  | "deployments"
  | "servers"
  | "keys"
  | "git-keys"
  | "ai"
  | "vpn"
  | "backup"
  | "security"
  | "docs";

type NavItem = {
  to: string;
  label: string;
  section: NavSection;
  end?: boolean;
  remember?: boolean;
};

const navItems: NavItem[] = [
  { to: "/", label: "Дашборд", section: "dashboard", end: true },
  { to: "/projects", label: "Проекты", section: "projects", remember: true },
  { to: "/deployments", label: "Деплои", section: "deployments", remember: true },
  { to: "/servers", label: "Серверы", section: "servers", remember: true },
  { to: "/keys", label: "SSH-ключи", section: "keys", remember: true },
  { to: "/git-keys", label: "Git-ключи", section: "git-keys", remember: true },
  { to: "/ai", label: "AI", section: "ai", remember: true },
  { to: "/vpn", label: "VPN", section: "vpn", remember: true },
  { to: "/backup", label: "Бэкап", section: "backup", remember: true },
  { to: "/security", label: "Безопасность", section: "security", remember: true },
  { to: "/docs", label: "Docs", section: "docs", remember: true },
];

const rememberedSections = new Set<NavSection>(
  navItems.filter((item) => item.remember).map((item) => item.section),
);
const lastRoutesStorageKey = "dankodeploy:last-section-routes";

function getSection(pathname: string): NavSection | null {
  if (pathname === "/") {
    return "dashboard";
  }

  const section = pathname.split("/")[1] as NavSection | undefined;
  if (section && rememberedSections.has(section)) {
    return section;
  }

  return null;
}

function readLastRoutes() {
  try {
    const raw = window.localStorage.getItem(lastRoutesStorageKey);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([section, path]) =>
          rememberedSections.has(section as NavSection) &&
          typeof path === "string" &&
          path.startsWith("/"),
      ),
    ) as Partial<Record<NavSection, string>>;
  } catch {
    return {};
  }
}

function writeLastRoutes(routes: Partial<Record<NavSection, string>>) {
  try {
    window.localStorage.setItem(lastRoutesStorageKey, JSON.stringify(routes));
  } catch {
    // Панель продолжит работать, даже если браузер запретил localStorage.
  }
}

export function App() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [lastRoutes, setLastRoutes] = useState<Partial<Record<NavSection, string>>>(readLastRoutes);
  const [deployLog, setDeployLog] = useState<DeployLogDrawerState | null>(getDeployLogDrawerState);
  // Мобильное меню (бургер). Закрывается при смене маршрута.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const me = useQuery({ queryKey: ["auth", "me"], queryFn: api.me });
  const appInfo = useQuery({
    queryKey: ["app", "info"],
    queryFn: api.health,
    refetchInterval: 60_000,
  });

  useEffect(() => subscribeDeployLogDrawer(setDeployLog), []);
  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  useEffect(() => {
    const section = getSection(location.pathname);
    if (!section || !rememberedSections.has(section)) {
      return;
    }

    const route = `${location.pathname}${location.search}${location.hash}`;
    setLastRoutes((current) => {
      if (current[section] === route) {
        return current;
      }

      const next = { ...current, [section]: route };
      writeLastRoutes(next);
      return next;
    });
  }, [location.hash, location.pathname, location.search]);

  const resolvedNavItems = useMemo(
    () =>
      navItems.map((item) => ({
        ...item,
        active: item.end
          ? location.pathname === item.to
          : getSection(location.pathname) === item.section,
        href: item.remember ? (lastRoutes[item.section] ?? item.to) : item.to,
      })),
    [lastRoutes, location.pathname],
  );

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      void navigate("/login", { replace: true });
    },
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-edge bg-panel/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-lg font-bold tracking-tight text-indigo-400">⚡ DankoDeploy</span>
            {appInfo.data && (
              <span
                className="text-[10px] font-medium text-slate-500"
                title={
                  appInfo.data.commit
                    ? `Версия ${appInfo.data.version}, commit ${appInfo.data.commit}`
                    : `Версия ${appInfo.data.version}`
                }
              >
                v{appInfo.data.version}
                {appInfo.data.commit && (
                  <span className="hidden sm:inline"> · {appInfo.data.commit.slice(0, 7)}</span>
                )}
              </span>
            )}
          </div>

          {/* Десктоп: горизонтальный ряд пунктов. Прячется на узких экранах. */}
          <nav className="hidden flex-wrap gap-1 lg:flex">
            {resolvedNavItems.map((item) => (
              <Link
                key={item.to}
                to={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  item.active ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-edge"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {me.data?.authRequired && (
            <button
              className="ml-auto hidden btn-ghost px-3 py-1.5 text-xs lg:inline-flex"
              onClick={() => logout.mutate()}
            >
              Выйти
            </button>
          )}

          {/* Мобайл: бургер. Виден до lg. */}
          <button
            className="ml-auto btn-ghost px-2.5 py-1.5 lg:hidden"
            aria-label="Меню"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            {mobileNavOpen ? "✕" : "☰"}
          </button>
        </div>

        {/* Мобильное выпадающее меню */}
        {mobileNavOpen && (
          <nav className="border-t border-edge px-4 py-2 lg:hidden">
            <div className="mx-auto grid max-w-6xl grid-cols-2 gap-1 sm:grid-cols-3">
              {resolvedNavItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    item.active ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-edge"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              {me.data?.authRequired && (
                <button
                  className="rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-400 hover:bg-edge"
                  onClick={() => logout.mutate()}
                >
                  Выйти
                </button>
              )}
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <Outlet />
      </main>
      {deployLog && (
        <DeployDrawer
          key={deployLog.runId}
          runId={deployLog.runId}
          projectName={deployLog.projectName}
          title={deployLog.title}
          onClose={closeDeployLogDrawer}
          onDone={() => {
            for (const queryKey of deployLog.invalidateKeys ?? []) {
              void qc.invalidateQueries({ queryKey });
            }
          }}
        />
      )}
    </div>
  );
}
