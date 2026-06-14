import { describe, expect, it } from "vitest";

import { shellQuote } from "./shell.js";

describe("shellQuote", () => {
  it("оборачивает в одинарные кавычки", () => {
    expect(shellQuote("prod.yml")).toBe("'prod.yml'");
  });

  it("нейтрализует метасимволы внутри кавычек", () => {
    expect(shellQuote("a; rm -rf /")).toBe("'a; rm -rf /'");
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
    expect(shellQuote("a`b`")).toBe("'a`b`'");
  });

  it("корректно экранирует одинарную кавычку (выход-вход)", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
