import { describe, expect, it } from "vitest";

import { isAllowedWsOrigin } from "./ws.js";

describe("isAllowedWsOrigin (анти-CSWSH)", () => {
  const WEB = "https://panel.example.com";

  it("пропускает совпадающий Origin", () => {
    expect(isAllowedWsOrigin(WEB, WEB)).toBe(true);
    expect(isAllowedWsOrigin(WEB, WEB + "/")).toBe(true); // хвостовой слэш в конфиге
  });

  it("отвергает чужой Origin (атака с другого сайта)", () => {
    expect(isAllowedWsOrigin("https://evil.com", WEB)).toBe(false);
    expect(isAllowedWsOrigin("https://panel.example.com.evil.com", WEB)).toBe(false);
    expect(isAllowedWsOrigin("http://panel.example.com", WEB)).toBe(false); // другая схема
  });

  it("пропускает отсутствующий Origin (не-браузерный клиент)", () => {
    expect(isAllowedWsOrigin(undefined, WEB)).toBe(true);
    expect(isAllowedWsOrigin("", WEB)).toBe(true);
  });
});
