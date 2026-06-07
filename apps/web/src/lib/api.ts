import type {
  AiAgentPublic,
  BackupRecord,
  ConnectionTestResult,
  CreateAiAgentInput,
  CreateDeploymentInput,
  ImportMode,
  ImportResult,
  CreateProjectInput,
  CreateServerInput,
  CreateVpnInstallationInput,
  VpnInstallationPublic,
  VpnReadiness,
  CreateVpnClientInput,
  VpnClientExitInfo,
  VpnClientPublic,
  VpnClientReadiness,
  VpnClientServer,
  VpnServiceCheck,
  DeployEnvResult,
  DeployKeyResult,
  DeploymentDetail,
  DeploymentPublic,
  DeployRun,
  GenerateGitKeyInput,
  GitKeyPublic,
  ImportGitKeyInput,
  ProjectEnv,
  ProvisionResult,
  GenerateSshKeyInput,
  ImportSshKeyInput,
  ContainerLogs,
  MetricsSnapshot,
  ProjectPublic,
  ServerPublic,
  StorageBreakdown,
  SshKeyPublic,
  UpdateProjectInput,
} from "@dankodeploy/shared";

/** Тонкая обёртка над fetch с разбором ошибок API. credentials — чтобы слать cookie сессии. */
async function http<T>(url: string, init?: RequestInit): Promise<T> {
  // Content-Type: application/json ставим только когда есть JSON-тело — иначе Fastify
  // отклоняет пустой body с этим заголовком (FST_ERR_CTP_EMPTY_JSON_BODY на DELETE/POST без payload).
  // Для FormData заголовок НЕ трогаем — браузер сам выставит multipart с boundary.
  const headers = { ...(init?.headers ?? {}) } as Record<string, string>;
  if (init?.body != null && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = typeof body.error === "string" ? body.error : JSON.stringify(body.error ?? body);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // --- Серверы ---
  listServers: () => http<ServerPublic[]>("/api/servers"),
  getServer: (id: string) => http<ServerPublic>(`/api/servers/${id}`),
  createServer: (input: CreateServerInput) =>
    http<ServerPublic>("/api/servers", { method: "POST", body: JSON.stringify(input) }),
  deleteServer: (id: string) => http<{ ok: true }>(`/api/servers/${id}`, { method: "DELETE" }),
  testServer: (id: string) =>
    http<ConnectionTestResult>(`/api/servers/${id}/test`, { method: "POST" }),
  testServerRaw: (input: CreateServerInput) =>
    http<ConnectionTestResult>("/api/servers/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  installDocker: (id: string) =>
    http<{ runId: string }>(`/api/servers/${id}/install-docker`, { method: "POST" }),
  installNode: (id: string) =>
    http<{ runId: string }>(`/api/servers/${id}/install-node`, { method: "POST" }),
  hardenSsh: (id: string) =>
    http<{ runId: string }>(`/api/servers/${id}/harden-ssh`, { method: "POST" }),
  serverMetrics: (id: string) => http<MetricsSnapshot>(`/api/servers/${id}/metrics`),
  /** Детальная разбивка диска (df + docker system df + du). Тяжёлая — по кнопке. */
  serverStorage: (id: string) => http<StorageBreakdown>(`/api/servers/${id}/storage`),
  /** Последние сохранённые снимки метрик всех серверов (для мгновенного показа). */
  lastMetrics: () => http<MetricsSnapshot[]>("/api/metrics/last"),
  /** Снимок последних `tail` строк логов docker-контейнера на сервере. */
  containerLogs: (serverId: string, name: string, tail = 200) =>
    http<ContainerLogs>(
      `/api/servers/${serverId}/containers/${encodeURIComponent(name)}/logs?tail=${tail}`,
    ),

  // --- SSH-ключи ---
  listKeys: () => http<SshKeyPublic[]>("/api/keys"),
  generateKey: (input: GenerateSshKeyInput) =>
    http<SshKeyPublic>("/api/keys/generate", { method: "POST", body: JSON.stringify(input) }),
  importKey: (input: ImportSshKeyInput) =>
    http<SshKeyPublic>("/api/keys/import", { method: "POST", body: JSON.stringify(input) }),
  deleteKey: (id: string) => http<{ ok: true }>(`/api/keys/${id}`, { method: "DELETE" }),
  deployKey: (id: string, serverId: string) =>
    http<DeployKeyResult>(`/api/keys/${id}/deploy`, {
      method: "POST",
      body: JSON.stringify({ serverId }),
    }),

  // --- Git deploy-ключи ---
  listGitKeys: () => http<GitKeyPublic[]>("/api/git-keys"),
  generateGitKey: (input: GenerateGitKeyInput) =>
    http<GitKeyPublic>("/api/git-keys/generate", { method: "POST", body: JSON.stringify(input) }),
  importGitKey: (input: ImportGitKeyInput) =>
    http<GitKeyPublic>("/api/git-keys/import", { method: "POST", body: JSON.stringify(input) }),
  deleteGitKey: (id: string) => http<{ ok: true }>(`/api/git-keys/${id}`, { method: "DELETE" }),

  // --- Проекты (карточки, без сервера) ---
  listProjects: () => http<ProjectPublic[]>("/api/projects"),
  getProject: (id: string) => http<ProjectPublic>(`/api/projects/${id}`),
  createProject: (input: CreateProjectInput) =>
    http<ProjectPublic>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  updateProject: (id: string, input: UpdateProjectInput) =>
    http<ProjectPublic>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteProject: (id: string) => http<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),

  // --- Бэкапы (история на проекте, общая по всем деплоям) ---
  backupHistory: (id: string) => http<BackupRecord[]>(`/api/projects/${id}/backups`),
  deleteBackup: (projectId: string, backupId: string) =>
    http<{ ok: true }>(`/api/projects/${projectId}/backups/${backupId}`, { method: "DELETE" }),
  uploadBackup: (id: string, file: File, artifactName?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (artifactName) form.append("artifactName", artifactName);
    return http<BackupRecord>(`/api/projects/${id}/backups/upload`, {
      method: "POST",
      body: form,
    });
  },
  // Скачать артефакт бэкапа на ПК. Тянем blob с cookie-сессией и триггерим download
  // (нельзя простым <a>, т.к. в dev фронт на другом порту — cookie не уедет с навигацией).
  downloadBackupArtifact: async (projectId: string, backupId: string, name: string) => {
    const url = `/api/projects/${projectId}/backups/${backupId}/artifacts/${encodeURIComponent(
      name,
    )}/download`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = typeof body.error === "string" ? body.error : message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = /filename="?([^"]+)"?/.exec(cd);
    const filename = m?.[1] ?? `${name}.bak`;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objUrl);
  },

  // --- Переменные окружения (.env) — на проекте (шаблон) ---
  getEnv: (id: string) => http<ProjectEnv>(`/api/projects/${id}/env`),
  saveEnv: (id: string, content: string) =>
    http<ProjectEnv>(`/api/projects/${id}/env`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  // --- Деплои (проект × сервер) ---
  listDeployments: () => http<DeploymentPublic[]>("/api/deployments"),
  listDeploymentsByProject: (projectId: string) =>
    http<DeploymentPublic[]>(`/api/deployments?projectId=${encodeURIComponent(projectId)}`),
  getDeployment: (id: string) => http<DeploymentDetail>(`/api/deployments/${id}`),
  createDeployment: (input: CreateDeploymentInput) =>
    http<DeploymentPublic>("/api/deployments", { method: "POST", body: JSON.stringify(input) }),
  deleteDeployment: (id: string) =>
    http<{ ok: true }>(`/api/deployments/${id}`, { method: "DELETE" }),

  provisionDeployment: (id: string) =>
    http<ProvisionResult>(`/api/deployments/${id}/provision`, { method: "POST" }),
  startDeploy: (id: string) =>
    http<{ runId: string }>(`/api/deployments/${id}/deploy`, { method: "POST" }),
  startUndeploy: (id: string) =>
    http<{ runId: string }>(`/api/deployments/${id}/undeploy`, { method: "POST" }),
  deployHistory: (id: string) => http<DeployRun[]>(`/api/deployments/${id}/deploys`),
  clearDeployHistory: (id: string) =>
    http<{ deleted: number }>(`/api/deployments/${id}/deploys`, { method: "DELETE" }),

  runBackup: (id: string) =>
    http<{ runId: string }>(`/api/deployments/${id}/backup`, { method: "POST" }),
  restoreBackup: (id: string, backupId: string, artifactNames?: string[]) =>
    http<{ runId: string }>(`/api/deployments/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ backupId, artifactNames }),
    }),
  deployEnv: (id: string) =>
    http<DeployEnvResult>(`/api/deployments/${id}/env/deploy`, { method: "POST" }),

  // --- Бэкап конфигурации (экспорт/импорт) ---
  // Экспорт отдаёт ZIP-файл — скачиваем напрямую, минуя http<T> (тело — Blob).
  exportConfig: async (
    password: string,
    includeBackupFiles: boolean,
  ): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch("/api/config/export", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, includeBackupFiles }),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = typeof body.error === "string" ? body.error : JSON.stringify(body.error ?? body);
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = /filename="?([^"]+)"?/.exec(cd);
    return { blob: await res.blob(), filename: m?.[1] ?? "dankodeploy-backup.zip" };
  },
  // Импорт: файл бэкапа (zip или legacy json) + пароль и режим как multipart.
  importConfig: (password: string, mode: ImportMode, file: File) => {
    const form = new FormData();
    form.append("password", password);
    form.append("mode", mode);
    form.append("file", file);
    return http<ImportResult>("/api/config/import", { method: "POST", body: form });
  },

  // --- Аутентификация ---
  me: () => http<{ authenticated: boolean; authRequired: boolean }>("/api/auth/me"),
  login: (password: string) =>
    http<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => http<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  // --- AI-агенты ---
  listAiAgents: () => http<AiAgentPublic[]>("/api/ai/agents"),
  createAiAgent: (input: CreateAiAgentInput) =>
    http<AiAgentPublic>("/api/ai/agents", { method: "POST", body: JSON.stringify(input) }),
  deleteAiAgent: (id: string) => http<{ ok: true }>(`/api/ai/agents/${id}`, { method: "DELETE" }),
  deployAiAgent: (id: string) =>
    http<{ ok: true }>(`/api/ai/agents/${id}/deploy`, { method: "POST" }),
  uninstallAiAgent: (id: string) =>
    http<{ ok: true }>(`/api/ai/agents/${id}/uninstall`, { method: "POST" }),
  startAiAgent: (id: string) =>
    http<{ ok: true }>(`/api/ai/agents/${id}/start`, { method: "POST" }),
  stopAiAgent: (id: string) =>
    http<{ ok: true }>(`/api/ai/agents/${id}/stop`, { method: "POST" }),
  aiAgentStatus: (id: string) =>
    http<{ status: string }>(`/api/ai/agents/${id}/status`),

  // --- VPN (Outline/Shadowsocks) ---
  listVpn: () => http<VpnInstallationPublic[]>("/api/vpn"),
  getVpn: (id: string) => http<VpnInstallationPublic>(`/api/vpn/${id}`),
  /** Проверка готовности сервера к раскатке VPN (readiness-чек + текущие метрики). */
  vpnReadiness: (serverId: string) =>
    http<VpnReadiness>("/api/vpn/readiness", {
      method: "POST",
      body: JSON.stringify({ serverId }),
    }),
  installVpn: (input: CreateVpnInstallationInput) =>
    http<{ runId: string }>("/api/vpn", { method: "POST", body: JSON.stringify(input) }),
  removeVpn: (id: string) => http<{ runId: string }>(`/api/vpn/${id}`, { method: "DELETE" }),

  // --- VPN-клиент (sing-box: весь трафик сервера через VPN-провайдера) ---
  listVpnClients: () => http<VpnClientPublic[]>("/api/vpn-client"),
  getVpnClient: (id: string) => http<VpnClientPublic>(`/api/vpn-client/${id}`),
  vpnClientReadiness: (serverId: string) =>
    http<VpnClientReadiness>("/api/vpn-client/readiness", {
      method: "POST",
      body: JSON.stringify({ serverId }),
    }),
  /** Спарсить подписку → список локаций для выбора. */
  parseSubscription: (subscriptionUrl: string) =>
    http<VpnClientServer[]>("/api/vpn-client/parse", {
      method: "POST",
      body: JSON.stringify({ subscriptionUrl }),
    }),
  installVpnClient: (input: CreateVpnClientInput) =>
    http<{ runId: string }>("/api/vpn-client", { method: "POST", body: JSON.stringify(input) }),
  /** Ручное обновление подписки (фон, возвращает runId для DeployDrawer). */
  syncVpnClient: (id: string) =>
    http<{ runId: string }>(`/api/vpn-client/${id}/sync`, { method: "POST" }),
  /** Внешний IP сервера + гео (страна/провайдер) для проверки выхода через VPN. */
  vpnClientExternalIp: (id: string) =>
    http<VpnClientExitInfo>(`/api/vpn-client/${id}/external-ip`),
  /** Проверка ChatGPT/Claude/Telegram с сервера (через VPN). */
  vpnClientServices: (id: string) =>
    http<VpnServiceCheck[]>(`/api/vpn-client/${id}/services`),
  /** Повторно включить выключенный клиент (с сохранённой подпиской/локацией). */
  enableVpnClient: (id: string) =>
    http<{ runId: string }>(`/api/vpn-client/${id}/enable`, { method: "POST" }),
  /** Локации из сохранённой подписки клиента (для выпадашки на карточке). */
  vpnClientLocations: (id: string) =>
    http<VpnClientServer[]>(`/api/vpn-client/${id}/locations`),
  /** Сменить локацию у подключённого клиента. */
  changeVpnClientLocation: (id: string, selectedLabel: string) =>
    http<{ runId: string }>(`/api/vpn-client/${id}/location`, {
      method: "POST",
      body: JSON.stringify({ selectedLabel }),
    }),
  /** Выключить (карточка остаётся). */
  disableVpnClient: (id: string) =>
    http<{ runId: string }>(`/api/vpn-client/${id}/disable`, { method: "POST" }),
  /** Удалить совсем (чистит sing-box на сервере + запись). */
  removeVpnClient: (id: string) =>
    http<{ runId: string }>(`/api/vpn-client/${id}`, { method: "DELETE" }),
};
