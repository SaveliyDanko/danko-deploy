import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

export const CONFIG_FILENAME = ".dankodeploy.json";

export interface CliConfig {
  version: 1;
  panelUrl: string;
  deploymentId: string;
}

export interface ResolvedCliConfig {
  config: CliConfig;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCliConfig(value: unknown): CliConfig {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error(`${CONFIG_FILENAME}: ожидается поле version со значением 1`);
  }
  if (typeof value.panelUrl !== "string") {
    throw new Error(`${CONFIG_FILENAME}: panelUrl должен быть строкой`);
  }
  let panelUrl: URL;
  try {
    panelUrl = new URL(value.panelUrl);
  } catch {
    throw new Error(`${CONFIG_FILENAME}: panelUrl должен быть корректным URL`);
  }
  if (!["http:", "https:"].includes(panelUrl.protocol)) {
    throw new Error(`${CONFIG_FILENAME}: panelUrl должен использовать http или https`);
  }
  if (panelUrl.username || panelUrl.password || panelUrl.search || panelUrl.hash) {
    throw new Error(`${CONFIG_FILENAME}: panelUrl не должен содержать credentials, query или hash`);
  }
  if (typeof value.deploymentId !== "string" || !value.deploymentId.trim()) {
    throw new Error(`${CONFIG_FILENAME}: deploymentId должен быть непустой строкой`);
  }
  return {
    version: 1,
    panelUrl: panelUrl.toString().replace(/\/$/, ""),
    deploymentId: value.deploymentId.trim(),
  };
}

export async function findCliConfig(startDir = process.cwd()): Promise<ResolvedCliConfig> {
  let current = resolve(startDir);
  const root = parse(current).root;

  while (true) {
    const path = join(current, CONFIG_FILENAME);
    try {
      const raw = await readFile(path, "utf8");
      return { config: parseCliConfig(JSON.parse(raw) as unknown), path };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        if (error instanceof SyntaxError) throw new Error(`${path}: некорректный JSON`);
        throw error;
      }
    }
    if (current === root) break;
    current = dirname(current);
  }

  throw new Error(
    `${CONFIG_FILENAME} не найден. Выполните dankodeploy init --url <URL> --deployment <ID>`,
  );
}

export async function saveCliConfig(
  directory: string,
  config: CliConfig,
  force: boolean,
): Promise<string> {
  const path = join(resolve(directory), CONFIG_FILENAME);
  if (!force) {
    try {
      await readFile(path, "utf8");
      throw new Error(`${path} уже существует; для перезаписи передайте --force`);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
    }
  }
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o644 });
  return path;
}
