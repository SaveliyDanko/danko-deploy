import { readFileSync } from "node:fs";

import type { AppInfo } from "@dankodeploy/shared";

interface PackageMetadata {
  version?: unknown;
}

/** Нормализует метаданные сборки, не позволяя произвольному env попасть в публичный API. */
export function resolveAppInfo(version: unknown, commit: string | undefined): AppInfo {
  const normalizedVersion =
    typeof version === "string" && version.trim() ? version.trim() : "unknown";
  const normalizedCommit = commit?.trim().toLowerCase();

  return {
    version: normalizedVersion,
    commit: normalizedCommit && /^[a-f0-9]{7,40}$/.test(normalizedCommit) ? normalizedCommit : null,
  };
}

function readPackageVersion(): unknown {
  try {
    // Путь одинаков по глубине для src/appInfo.ts и собранного dist/main.js.
    const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as PackageMetadata).version;
  } catch {
    // Health endpoint должен оставаться доступным даже при повреждённой метаинформации образа.
    return undefined;
  }
}

/** Метаданные фиксируются один раз при старте и описывают именно запущенный процесс. */
export const appInfo = resolveAppInfo(readPackageVersion(), process.env.DANKODEPLOY_COMMIT);
