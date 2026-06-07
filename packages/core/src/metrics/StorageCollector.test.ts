import { describe, expect, it } from "vitest";

import { parseDockerDf, parseDu, parseHumanSize } from "./StorageCollector.js";

describe("parseHumanSize", () => {
  it("разбирает десятичные единицы docker", () => {
    expect(parseHumanSize("1.5GB")).toBe(1_500_000_000);
    expect(parseHumanSize("456MB")).toBe(456_000_000);
    expect(parseHumanSize("0B")).toBe(0);
    expect(parseHumanSize("2KB")).toBe(2000);
  });

  it("разбирает бинарные единицы (KiB/MiB)", () => {
    expect(parseHumanSize("1KiB")).toBe(1024);
    expect(parseHumanSize("1MiB")).toBe(1024 * 1024);
  });

  it("возвращает 0 для пустой/битой строки", () => {
    expect(parseHumanSize("")).toBe(0);
    expect(parseHumanSize(undefined)).toBe(0);
    expect(parseHumanSize("N/A")).toBe(0);
  });
});

describe("parseDockerDf", () => {
  it("разбирает табулированный вывод docker system df", () => {
    const block = [
      "Images\t10\t3\t2.5GB\t1.8GB (72%)",
      "Containers\t5\t2\t100MB\t50MB (50%)",
      "Local Volumes\t4\t4\t500MB\t0B (0%)",
      "Build Cache\t20\t0\t1GB\t1GB",
    ].join("\n");
    const out = parseDockerDf(block);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      type: "Images",
      total: 10,
      active: 3,
      sizeBytes: 2_500_000_000,
      reclaimableBytes: 1_800_000_000,
    });
    expect(out[3]!.reclaimableBytes).toBe(1_000_000_000);
  });

  it("пустой вывод (docker недоступен) → пустой массив", () => {
    expect(parseDockerDf("")).toEqual([]);
  });
});

describe("parseDu", () => {
  it("разбирает вывод du -b, пропуская корень", () => {
    const block = ["53660876800\t/", "12000000000\t/var", "8000000000\t/home"].join("\n");
    const out = parseDu(block);
    expect(out).toEqual([
      { path: "/var", sizeBytes: 12000000000 },
      { path: "/home", sizeBytes: 8000000000 },
    ]);
  });

  it("пропускает битые строки и пустой ввод", () => {
    expect(parseDu("")).toEqual([]);
    expect(parseDu("garbage\nNaN /x")).toEqual([]);
  });
});
