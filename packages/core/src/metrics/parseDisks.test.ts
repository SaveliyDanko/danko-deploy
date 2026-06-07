import { describe, expect, it } from "vitest";

import { parseDisks } from "./MetricsCollector.js";

// Формат блока — вывод `df -PB1 | awk '{print $6, $2, $3, $5}'`:
// mount totalBytes usedBytes use%
describe("parseDisks", () => {
  it("разбирает обычный диск", () => {
    const disks = parseDisks("/ 53660876800 12000000000 23%");
    expect(disks).toEqual([
      { mount: "/", totalBytes: 53660876800, usedBytes: 12000000000, usePercent: 23 },
    ]);
  });

  it("отбрасывает служебный mount с нулевым объёмом (/run/credentials/*)", () => {
    const block = [
      "/ 53660876800 12000000000 23%",
      "/run/credentials/systemd-journald.service 0 0 -", // нулевой том → мусор
    ].join("\n");
    const disks = parseDisks(block);
    expect(disks).toHaveLength(1);
    expect(disks[0]!.mount).toBe("/");
  });

  it("пропускает пустые строки и строки с нечисловым объёмом", () => {
    const block = ["", "/ 100 50 50%", "garbage line", "  "].join("\n");
    const disks = parseDisks(block);
    expect(disks).toHaveLength(1);
    expect(disks[0]!.totalBytes).toBe(100);
  });

  it("нормализует отсутствующий/битый use% в 0", () => {
    const disks = parseDisks("/data 200 0 -");
    expect(disks[0]!.usePercent).toBe(0);
    expect(disks[0]!.usedBytes).toBe(0);
  });
});
