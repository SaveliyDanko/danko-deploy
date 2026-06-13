import { describe, expect, it } from "vitest";

import { backupFilename, confineToBackupDir } from "./ConfigBackupService.js";

describe("backupFilename", () => {
  it("включает дату и время (различает бэкапы внутри одного дня)", () => {
    const morning = backupFilename(new Date("2026-06-08T09:05:01Z"));
    const evening = backupFilename(new Date("2026-06-08T21:42:30Z"));
    expect(morning).toBe("dankodeploy-backup-2026-06-08_09-05-01.zip");
    expect(evening).toBe("dankodeploy-backup-2026-06-08_21-42-30.zip");
    expect(morning).not.toBe(evening); // главное: имена в один день различаются
  });

  it("не содержит двоеточий (безопасно для имени файла и HTTP-заголовка)", () => {
    expect(backupFilename(new Date("2026-06-08T21:42:30Z"))).not.toContain(":");
  });
});

describe("confineToBackupDir (анти path-traversal при импорте)", () => {
  const DIR = "/srv/backups";

  it("обычное имя кладёт внутрь BACKUP_DIR", () => {
    expect(confineToBackupDir(DIR, "backups/db-123.bak")).toBe("/srv/backups/db-123.bak");
    expect(confineToBackupDir(DIR, "db-123.bak")).toBe("/srv/backups/db-123.bak");
  });

  it("абсолютные/traversal-пути сводятся к basename внутри BACKUP_DIR", () => {
    expect(confineToBackupDir(DIR, "/etc/passwd")).toBe("/srv/backups/passwd");
    expect(confineToBackupDir(DIR, "../../etc/shadow")).toBe("/srv/backups/shadow");
    expect(confineToBackupDir(DIR, "/root/.ssh/id_ed25519")).toBe("/srv/backups/id_ed25519");
  });

  it("опасные/пустые basename → null (артефакт без файла)", () => {
    expect(confineToBackupDir(DIR, "..")).toBeNull();
    expect(confineToBackupDir(DIR, "x/..")).toBeNull();
    expect(confineToBackupDir(DIR, ".")).toBeNull();
    expect(confineToBackupDir(DIR, "")).toBeNull();
  });
});
