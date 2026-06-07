import { describe, expect, it } from "vitest";

import { formatBytes, formatDate, formatUptime } from "./format.js";

describe("formatBytes", () => {
  it("null/undefined → тире", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("байты без дробной части", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("масштабирует до KB/MB/GB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("≥10 в единице → без дробной части", () => {
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });

  it("не выходит за TB (верхняя единица)", () => {
    expect(formatBytes(5 * 1024 ** 4)).toContain("TB");
  });
});

describe("formatUptime", () => {
  it("null → тире", () => {
    expect(formatUptime(null)).toBe("—");
  });

  it("минуты", () => {
    expect(formatUptime(120)).toBe("2м");
  });

  it("часы и минуты", () => {
    expect(formatUptime(3600 + 120)).toBe("1ч 2м");
  });

  it("дни и часы (минуты опускаются)", () => {
    expect(formatUptime(86400 + 3600 * 3)).toBe("1д 3ч");
  });

  it("ноль секунд → 0м", () => {
    expect(formatUptime(0)).toBe("0м");
  });
});

describe("formatDate", () => {
  it("пусто → тире", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("невалидная дата → возвращает исходную строку как есть", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("валидный ISO → непустая локализованная строка", () => {
    const out = formatDate("2026-06-07T12:30:00.000Z");
    expect(out).not.toBe("—");
    expect(out.length).toBeGreaterThan(0);
  });
});
