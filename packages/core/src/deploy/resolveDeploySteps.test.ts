import type { ProjectConfig } from "@dankodeploy/shared";
import { describe, expect, it } from "vitest";

import { resolveDeploySteps } from "./DeployRunner.js";

const baseConfig: ProjectConfig = { workdir: "/srv/app" };

describe("resolveDeploySteps", () => {
  it("docker-compose: чистит и dangling-образы, и build cache (рост диска)", () => {
    const steps = resolveDeploySteps({ kind: "docker-compose", config: baseConfig });
    const runs = steps.map((s) => s.run);
    expect(runs).toContain("docker image prune -f");
    expect(runs).toContain("docker builder prune -f");
    // up идёт ДО prune — сначала поднимаем, потом убираем мусор.
    expect(runs.indexOf("docker compose up -d --build")).toBeLessThan(
      runs.indexOf("docker builder prune -f"),
    );
  });

  it("учитывает composeFile в шагах (значение экранировано для shell)", () => {
    const steps = resolveDeploySteps({
      kind: "docker-compose",
      config: { ...baseConfig, composeFile: "prod.yml" },
    });
    expect(steps.some((s) => s.run.includes("docker compose -f 'prod.yml' up -d --build"))).toBe(true);
  });

  it("composeFile с shell-метасимволами безопасно экранируется", () => {
    const steps = resolveDeploySteps({
      kind: "docker-compose",
      config: { ...baseConfig, composeFile: "a.yml; rm -rf /" },
    });
    // Опасный composeFile целиком внутри одинарных кавычек — не интерпретируется shell.
    expect(steps.some((s) => s.run.includes("-f 'a.yml; rm -rf /'"))).toBe(true);
  });

  it("кастомные deploySteps переопределяют дефолты", () => {
    const custom = [{ name: "Custom", run: "echo hi" }];
    const steps = resolveDeploySteps({
      kind: "docker-compose",
      config: { ...baseConfig, deploySteps: custom },
    });
    expect(steps).toEqual(custom);
  });
});
