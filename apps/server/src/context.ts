import { LocalExecutor, SshExecutor } from "@dankodeploy/core";
import { createDb } from "@dankodeploy/db";

import type { AppConfig } from "./config.js";
import { AiAgentService } from "./services/AiAgentService.js";
import { AuthService } from "./services/AuthService.js";
import { BackupScheduler } from "./services/BackupScheduler.js";
import { BackupService } from "./services/BackupService.js";
import { ConfigBackupService } from "./services/ConfigBackupService.js";
import { DeploymentService } from "./services/DeploymentService.js";
import { DeployService } from "./services/DeployService.js";
import { EnvService } from "./services/EnvService.js";
import { GitKeyService } from "./services/GitKeyService.js";
import { ProvisionService } from "./services/ProvisionService.js";
import { MetricsBroadcaster } from "./services/MetricsBroadcaster.js";
import { MetricsStore } from "./services/MetricsStore.js";
import { ProjectService } from "./services/ProjectService.js";
import { ServerService } from "./services/ServerService.js";
import { ServerSetupService } from "./services/ServerSetupService.js";
import { SshKeyService } from "./services/SshKeyService.js";
import { TerminalBridge } from "./services/TerminalBridge.js";
import { TwoFactorService } from "./services/TwoFactorService.js";
import { VpnClientService } from "./services/VpnClientService.js";
import { VpnClientScheduler } from "./services/VpnClientScheduler.js";
import { VpnService } from "./services/VpnService.js";
import { WsHub } from "./ws/WsHub.js";

/** Контейнер зависимостей приложения — собирается один раз при старте. */
export interface AppContext {
  config: AppConfig;
  ssh: SshExecutor;
  local: LocalExecutor;
  hub: WsHub;
  auth: AuthService;
  twoFactor: TwoFactorService;
  servers: ServerService;
  serverSetup: ServerSetupService;
  keys: SshKeyService;
  gitKeys: GitKeyService;
  projects: ProjectService;
  deployments: DeploymentService;
  env: EnvService;
  deploys: DeployService;
  provision: ProvisionService;
  backups: BackupService;
  configBackup: ConfigBackupService;
  scheduler: BackupScheduler;
  metrics: MetricsBroadcaster;
  metricsStore: MetricsStore;
  aiAgents: AiAgentService;
  vpn: VpnService;
  vpnClient: VpnClientService;
  vpnClientScheduler: VpnClientScheduler;
  terminal: TerminalBridge;
  dispose: () => void;
}

export function buildContext(config: AppConfig): AppContext {
  const { db, sqlite } = createDb(config.databaseUrl);
  const local = new LocalExecutor();
  const ssh = new SshExecutor();
  ssh.setLocal(local);

  const hub = new WsHub();
  const twoFactor = new TwoFactorService(db, config.masterKey);
  const auth = new AuthService(config.authPasswordHash, config.sessionSecret, () =>
    twoFactor.sessionVersion(),
  );

  const servers = new ServerService(db, ssh, config.masterKey);
  // TOFU-верификация host key: SshExecutor запоминает/сверяет ключ через ServerService.
  ssh.setHostKeyStore({
    get: (id) => servers.getHostKey(id),
    set: (id, fp) => servers.recordHostKey(id, fp),
  });
  const keys = new SshKeyService(db, ssh, config.masterKey, servers);
  servers.setKeyResolver((keyId) => {
    const row = keys.getRow(keyId);
    return row ? keys.decrypt(row) : undefined;
  });
  const gitKeys = new GitKeyService(db, config.masterKey);
  const projects = new ProjectService(db);
  const deployments = new DeploymentService(db, ssh, projects, servers);
  const serverSetup = new ServerSetupService(ssh, servers, hub);
  const env = new EnvService(db, ssh, config.masterKey, deployments, servers);
  const deploys = new DeployService(db, ssh, deployments, servers, gitKeys, hub);
  const provision = new ProvisionService(db, ssh, deployments, servers, gitKeys, hub);
  const backups = new BackupService(db, ssh, projects, servers, deployments, config.backupDir, hub);
  const configBackup = new ConfigBackupService(sqlite, config.masterKey, config.backupDir);
  const scheduler = new BackupScheduler(projects, deployments, backups);
  const metricsStore = new MetricsStore(db);
  const metrics = new MetricsBroadcaster(ssh, servers, hub, metricsStore);
  const aiAgents = new AiAgentService(db, ssh, servers, hub);
  const vpn = new VpnService(db, ssh, config.masterKey, servers, hub);
  const vpnClient = new VpnClientService(db, ssh, config.masterKey, servers, hub);
  const vpnClientScheduler = new VpnClientScheduler(db, vpnClient);
  vpnClientScheduler.reload();
  const terminal = new TerminalBridge(ssh, servers, aiAgents);

  return {
    config,
    ssh,
    local,
    hub,
    auth,
    twoFactor,
    servers,
    serverSetup,
    keys,
    gitKeys,
    projects,
    deployments,
    env,
    deploys,
    provision,
    backups,
    configBackup,
    scheduler,
    metrics,
    metricsStore,
    aiAgents,
    vpn,
    vpnClient,
    vpnClientScheduler,
    terminal,
    dispose: () => {
      scheduler.stopAll();
      vpnClientScheduler.stopAll();
      metrics.stop();
      terminal.disposeAll();
      ssh.disposeAll();
      sqlite.close();
    },
  };
}
