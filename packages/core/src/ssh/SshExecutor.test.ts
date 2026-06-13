import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { classifySshError, HostKeyMismatchError, hostKeyFingerprint } from "./SshExecutor.js";

describe("hostKeyFingerprint", () => {
  it("формат SHA256:base64 без паддинга, как ssh-keygen", () => {
    const key = Buffer.from("ssh-ed25519 AAAA...пример-ключа");
    const fp = hostKeyFingerprint(key);
    const expected =
      "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
    expect(fp).toBe(expected);
    expect(fp.startsWith("SHA256:")).toBe(true);
    expect(fp.endsWith("=")).toBe(false);
  });

  it("детерминирован для одного ключа и различается для разных", () => {
    const a = Buffer.from("key-a");
    const b = Buffer.from("key-b");
    expect(hostKeyFingerprint(a)).toBe(hostKeyFingerprint(a));
    expect(hostKeyFingerprint(a)).not.toBe(hostKeyFingerprint(b));
  });
});

describe("classifySshError: host key mismatch", () => {
  it("HostKeyMismatchError классифицируется как kind=hostkey", () => {
    const err = new HostKeyMismatchError("srv1", "SHA256:aaa", "SHA256:bbb");
    const info = classifySshError(err);
    expect(info.kind).toBe("hostkey");
    expect(info.message).toContain("ИЗМЕНИЛСЯ");
  });
});
