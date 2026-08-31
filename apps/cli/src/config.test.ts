import { describe, expect, it } from "vitest";

import { parseCliConfig } from "./config.js";

describe("parseCliConfig", () => {
  it("нормализует URL и deploymentId", () => {
    expect(
      parseCliConfig({
        version: 1,
        panelUrl: "https://deploy.example.com/",
        deploymentId: " dep-1 ",
      }),
    ).toEqual({
      version: 1,
      panelUrl: "https://deploy.example.com",
      deploymentId: "dep-1",
    });
  });

  it("запрещает неизвестную версию и небезопасный протокол", () => {
    expect(() => parseCliConfig({ version: 2 })).toThrow(/version/);
    expect(() =>
      parseCliConfig({ version: 1, panelUrl: "file:///tmp/panel", deploymentId: "dep-1" }),
    ).toThrow(/http/);
    expect(() =>
      parseCliConfig({
        version: 1,
        panelUrl: "https://token@deploy.example.com/?secret=1",
        deploymentId: "dep-1",
      }),
    ).toThrow(/credentials/);
  });
});
