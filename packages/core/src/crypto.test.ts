import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  deriveKeyFromPassword,
  encryptSecret,
  hashPassword,
  loadMasterKey,
  verifyPassword,
} from "./crypto.js";

/** Валидный мастер-ключ (32 байта) для тестов. */
const key = randomBytes(32);

describe("loadMasterKey", () => {
  it("принимает корректный base64-ключ 32 байта", () => {
    const raw = randomBytes(32).toString("base64");
    expect(loadMasterKey(raw)).toHaveLength(32);
  });

  it("бросает, если ключ не задан", () => {
    expect(() => loadMasterKey(undefined)).toThrow(/MASTER_KEY/);
  });

  it("бросает при неверной длине ключа", () => {
    const short = randomBytes(16).toString("base64");
    expect(() => loadMasterKey(short)).toThrow(/32 байта/);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trip: расшифровка возвращает исходную строку", () => {
    const plain = "super-secret-ssh-key\nwith newlines и юникод 🔐";
    const enc = encryptSecret(plain, key);
    expect(decryptSecret(enc, key)).toBe(plain);
  });

  it("шифротекст не содержит открытый текст", () => {
    const plain = "PLAINTEXT_MARKER";
    const enc = encryptSecret(plain, key);
    expect(enc).not.toContain(plain);
  });

  it("формат — три base64-части через двоеточие (iv:tag:cipher)", () => {
    const enc = encryptSecret("x", key);
    expect(enc.split(":")).toHaveLength(3);
  });

  it("один и тот же текст шифруется по-разному (случайный IV)", () => {
    const a = encryptSecret("same", key);
    const b = encryptSecret("same", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe(decryptSecret(b, key));
  });

  it("расшифровка чужим ключом проваливается (GCM-аутентификация)", () => {
    const enc = encryptSecret("secret", key);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });

  it("повреждённый формат → понятная ошибка", () => {
    expect(() => decryptSecret("not-a-valid-payload", key)).toThrow(/Повреждённый формат/);
  });

  it("подмена шифротекста ломает аутентификацию", () => {
    const enc = encryptSecret("secret", key);
    const [iv, tag, data] = enc.split(":");
    // Портим данные, оставляя iv/tag — GCM-тег не сойдётся.
    const tampered = [iv, tag, Buffer.from("hacked").toString("base64")].join(":");
    void data;
    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});

describe("hashPassword / verifyPassword", () => {
  it("верный пароль проходит проверку", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("correct horse", stored)).toBe(true);
  });

  it("неверный пароль не проходит", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("хэш содержит соль (одинаковый пароль → разные хэши)", () => {
    expect(hashPassword("pw")).not.toBe(hashPassword("pw"));
  });

  it("формат хранения — salt:hash в hex", () => {
    const stored = hashPassword("pw");
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it("битый формат хранилища → false, не бросает", () => {
    expect(verifyPassword("pw", "garbage")).toBe(false);
    expect(verifyPassword("pw", "")).toBe(false);
  });
});

describe("deriveKeyFromPassword", () => {
  it("даёт 32-байтный ключ", () => {
    expect(deriveKeyFromPassword("pw", randomBytes(16))).toHaveLength(32);
  });

  it("детерминирован при одинаковых пароле и соли", () => {
    const salt = randomBytes(16);
    expect(deriveKeyFromPassword("pw", salt)).toEqual(deriveKeyFromPassword("pw", salt));
  });

  it("разная соль → разный ключ", () => {
    const a = deriveKeyFromPassword("pw", randomBytes(16));
    const b = deriveKeyFromPassword("pw", randomBytes(16));
    expect(a).not.toEqual(b);
  });

  it("ключ из пароля совместим с encrypt/decrypt (как в бэкапе конфигурации)", () => {
    const salt = randomBytes(16);
    const derived = deriveKeyFromPassword("export-password", salt);
    const enc = encryptSecret("backup-secret", derived);
    // Тот же пароль+соль → тот же ключ → расшифровка проходит.
    const again = deriveKeyFromPassword("export-password", salt);
    expect(decryptSecret(enc, again)).toBe("backup-secret");
  });
});
