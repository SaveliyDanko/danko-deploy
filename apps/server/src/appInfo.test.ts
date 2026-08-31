import { describe, expect, it } from "vitest";

import { resolveAppInfo } from "./appInfo.js";

describe("resolveAppInfo", () => {
  it("возвращает версию и нормализованный git commit", () => {
    expect(resolveAppInfo("0.1.0", " C9E6D4F12345 ")).toEqual({
      version: "0.1.0",
      commit: "c9e6d4f12345",
    });
  });

  it("скрывает некорректный commit и сохраняет доступность health", () => {
    expect(resolveAppInfo(undefined, "main; rm -rf /")).toEqual({
      version: "unknown",
      commit: null,
    });
  });
});
