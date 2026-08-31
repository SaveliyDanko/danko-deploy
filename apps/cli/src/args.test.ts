import { describe, expect, it } from "vitest";

import { optionValue, optionValues, parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("разбирает значения, флаги и повторяемые параметры", () => {
    const args = parseArgs([
      "restore",
      "--backup=b1",
      "--artifact",
      "db",
      "--artifact",
      "media",
      "--no-wait",
    ]);

    expect(args.command).toBe("restore");
    expect(optionValue(args, "backup")).toBe("b1");
    expect(optionValues(args, "artifact")).toEqual(["db", "media"]);
    expect(optionValue(args, "no-wait")).toBe("true");
  });
});
