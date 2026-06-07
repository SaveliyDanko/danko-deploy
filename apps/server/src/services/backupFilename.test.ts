import { describe, expect, it } from "vitest";

import { backupFilename } from "./ConfigBackupService.js";

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
