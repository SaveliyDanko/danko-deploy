#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";

import type { BackupRecord, DeployRun, DeploymentDetail } from "@dankodeploy/shared";

import {
  assertOptions,
  hasOption,
  optionValue,
  optionValues,
  parseArgs,
  type ParsedArgs,
} from "./args.js";
import { ApiError, DankoDeployClient } from "./client.js";
import { findCliConfig, parseCliConfig, saveCliConfig, type CliConfig } from "./config.js";

const HELP = `DankoDeploy CLI — JSON-first интерфейс для LLM-агентов

Использование:
  dankodeploy init --url <URL> --deployment <ID> [--force]
  dankodeploy context [--runs <N>] [--backups <N>]
  dankodeploy status
  dankodeploy runs [--limit <N>]
  dankodeploy backups [--limit <N>]
  dankodeploy deploy|provision|undeploy|backup [--no-wait] [--timeout <сек>]
  dankodeploy restore --backup <ID> [--artifact <имя> ...] [--no-wait] [--timeout <сек>]
  dankodeploy env-deploy
  dankodeploy config

Секрет передаётся только через DANKODEPLOY_TOKEN. Все результаты, кроме help, — JSON.
`;

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name} должен быть целым числом > 0`);
  return value;
}

async function configuredClient(): Promise<{
  client: DankoDeployClient;
  config: CliConfig;
}> {
  const resolved = await findCliConfig();
  return {
    client: new DankoDeployClient(resolved.config.panelUrl, process.env.DANKODEPLOY_TOKEN),
    config: resolved.config,
  };
}

async function waitForRun(
  client: DankoDeployClient,
  deploymentId: string,
  runId: string,
  timeoutSeconds: number,
): Promise<DeployRun> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const runs = await client.request<DeployRun[]>(
      "GET",
      `/api/deployments/${encodeURIComponent(deploymentId)}/deploys`,
    );
    const run = runs.find((item) => item.id === runId);
    if (run && run.status !== "running") return run;
    await delay(1_000);
  }
  throw new Error(`Операция ${runId} не завершилась за ${timeoutSeconds} секунд`);
}

async function mutation(
  args: ParsedArgs,
  operation: "deploy" | "provision" | "undeploy" | "backup" | "restore",
  body?: unknown,
): Promise<void> {
  assertOptions(
    args,
    operation === "restore" ? ["no-wait", "timeout", "backup", "artifact"] : ["no-wait", "timeout"],
  );
  const { client, config } = await configuredClient();
  const result = await client.request<{ runId: string }>(
    "POST",
    `/api/deployments/${encodeURIComponent(config.deploymentId)}/${operation}`,
    body,
  );
  if (hasOption(args, "no-wait")) {
    output({ ok: true, operation, runId: result.runId, status: "running" });
    return;
  }
  const timeout = positiveInteger(optionValue(args, "timeout"), 900, "timeout");
  const run = await waitForRun(client, config.deploymentId, result.runId, timeout);
  output({ ok: run.status === "success", operation, run });
  if (run.status !== "success") process.exitCode = 2;
}

async function init(args: ParsedArgs): Promise<void> {
  assertOptions(args, ["url", "deployment", "force"]);
  const url = optionValue(args, "url");
  const deploymentId = optionValue(args, "deployment");
  if (!url || !deploymentId) {
    throw new Error("init требует --url <URL> и --deployment <ID>");
  }
  const config = parseCliConfig({ version: 1, panelUrl: url, deploymentId });
  const client = new DankoDeployClient(config.panelUrl, process.env.DANKODEPLOY_TOKEN);
  const detail = await client.request<DeploymentDetail>(
    "GET",
    `/api/deployments/${encodeURIComponent(config.deploymentId)}`,
  );
  const path = await saveCliConfig(process.cwd(), config, hasOption(args, "force"));
  output({
    ok: true,
    configPath: path,
    deployment: {
      id: detail.deployment.id,
      project: detail.project.name,
      server: detail.serverName,
    },
  });
}

async function context(args: ParsedArgs): Promise<void> {
  assertOptions(args, ["runs", "backups"]);
  const runLimit = positiveInteger(optionValue(args, "runs"), 5, "runs");
  const backupLimit = positiveInteger(optionValue(args, "backups"), 5, "backups");
  const { client, config } = await configuredClient();
  const detail = await client.request<DeploymentDetail>(
    "GET",
    `/api/deployments/${encodeURIComponent(config.deploymentId)}`,
  );
  const [runs, backups] = await Promise.all([
    client.request<DeployRun[]>(
      "GET",
      `/api/deployments/${encodeURIComponent(config.deploymentId)}/deploys`,
    ),
    client.request<BackupRecord[]>(
      "GET",
      `/api/projects/${encodeURIComponent(detail.project.id)}/backups`,
    ),
  ]);
  output({
    deployment: detail,
    runs: runs.slice(0, runLimit),
    backups: backups.slice(0, backupLimit),
  });
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.command ||
    args.command === "help" ||
    args.command === "--help" ||
    hasOption(args, "help")
  ) {
    process.stdout.write(HELP);
    return;
  }

  switch (args.command) {
    case "init":
      await init(args);
      return;
    case "config": {
      assertOptions(args, []);
      const resolved = await findCliConfig();
      output({
        path: resolved.path,
        ...resolved.config,
        tokenConfigured: !!process.env.DANKODEPLOY_TOKEN,
      });
      return;
    }
    case "status": {
      assertOptions(args, []);
      const { client, config } = await configuredClient();
      output(
        await client.request<DeploymentDetail>(
          "GET",
          `/api/deployments/${encodeURIComponent(config.deploymentId)}`,
        ),
      );
      return;
    }
    case "context":
      await context(args);
      return;
    case "runs": {
      assertOptions(args, ["limit"]);
      const limit = positiveInteger(optionValue(args, "limit"), 20, "limit");
      const { client, config } = await configuredClient();
      const runs = await client.request<DeployRun[]>(
        "GET",
        `/api/deployments/${encodeURIComponent(config.deploymentId)}/deploys`,
      );
      output(runs.slice(0, limit));
      return;
    }
    case "backups": {
      assertOptions(args, ["limit"]);
      const limit = positiveInteger(optionValue(args, "limit"), 20, "limit");
      const { client, config } = await configuredClient();
      const detail = await client.request<DeploymentDetail>(
        "GET",
        `/api/deployments/${encodeURIComponent(config.deploymentId)}`,
      );
      const backups = await client.request<BackupRecord[]>(
        "GET",
        `/api/projects/${encodeURIComponent(detail.project.id)}/backups`,
      );
      output(backups.slice(0, limit));
      return;
    }
    case "deploy":
    case "provision":
    case "undeploy":
    case "backup":
      await mutation(args, args.command);
      return;
    case "restore": {
      const backupId = optionValue(args, "backup");
      if (!backupId) throw new Error("restore требует --backup <ID>");
      const artifactNames = optionValues(args, "artifact");
      await mutation(args, "restore", {
        backupId,
        artifactNames: artifactNames.length ? artifactNames : undefined,
      });
      return;
    }
    case "env-deploy": {
      assertOptions(args, []);
      const { client, config } = await configuredClient();
      output(
        await client.request(
          "POST",
          `/api/deployments/${encodeURIComponent(config.deploymentId)}/env/deploy`,
        ),
      );
      return;
    }
    default:
      throw new Error(`Неизвестная команда: ${args.command}. Выполните dankodeploy help`);
  }
}

run().catch((error: unknown) => {
  const result: Record<string, unknown> = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof ApiError) {
    result.status = error.status;
    result.details = error.details;
    if (error.status === 401) {
      result.hint = "Задайте DANKODEPLOY_TOKEN, созданный командой pnpm gen-token";
    }
  }
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
});
