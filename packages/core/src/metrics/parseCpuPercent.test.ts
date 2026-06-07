import { describe, expect, it } from "vitest";

import { parseCpuPercent } from "./MetricsCollector.js";

// Строка /proc/stat: cpu user nice system idle iowait irq softirq steal ...
describe("parseCpuPercent", () => {
  it("считает загрузку из дельты двух снимков", () => {
    // 1-й: total=1000, idle=900. 2-й: total=1100, idle=950.
    // Δtotal=100, Δidle=50 → usage = 50% .
    const block = ["cpu 100 0 0 900 0 0 0 0 0 0", "cpu 120 0 30 950 0 0 0 0 0 0"].join("\n");
    expect(parseCpuPercent(block)).toBe(50);
  });

  it("полный простой → 0%", () => {
    const block = ["cpu 100 0 0 900 0 0 0 0 0 0", "cpu 100 0 0 1000 0 0 0 0 0 0"].join("\n");
    expect(parseCpuPercent(block)).toBe(0);
  });

  it("полная загрузка → 100%", () => {
    const block = ["cpu 100 0 0 900 0 0 0 0 0 0", "cpu 200 0 0 900 0 0 0 0 0 0"].join("\n");
    expect(parseCpuPercent(block)).toBe(100);
  });

  it("iowait учитывается как простой (CPU не занят в ожидании I/O)", () => {
    // Между замерами прибавилось только iowait (поле 5) — CPU простаивал.
    const block = ["cpu 100 0 0 900 100 0 0 0 0 0", "cpu 100 0 0 900 200 0 0 0 0 0"].join("\n");
    expect(parseCpuPercent(block)).toBe(0);
  });

  it("нет тиков между замерами → 0%", () => {
    const block = ["cpu 100 0 0 900 0 0 0 0 0 0", "cpu 100 0 0 900 0 0 0 0 0 0"].join("\n");
    expect(parseCpuPercent(block)).toBe(0);
  });

  it("игнорирует per-core строки (cpu0, cpu1), берёт только агрегат `cpu `", () => {
    const block = [
      "cpu 100 0 0 900 0 0 0 0 0 0",
      "cpu0 50 0 0 450 0 0 0 0 0 0",
      "cpu 200 0 0 900 0 0 0 0 0 0",
      "cpu1 100 0 0 450 0 0 0 0 0 0",
    ].join("\n");
    expect(parseCpuPercent(block)).toBe(100);
  });

  it("возвращает null при неполном/битом вводе", () => {
    expect(parseCpuPercent("")).toBeNull();
    expect(parseCpuPercent("cpu 100 0 0 900 0 0 0 0 0 0")).toBeNull(); // только один снимок
    expect(parseCpuPercent("garbage\nmore garbage")).toBeNull();
  });
});
