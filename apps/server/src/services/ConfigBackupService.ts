import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { decryptSecret, deriveKeyFromPassword, encryptSecret } from "@dankodeploy/core";
import type { SqliteDb } from "@dankodeploy/db";
import {
  configBackupSchema,
  type ConfigBackup,
  type ConfigBackupData,
  type ImportMode,
  type ImportResult,
} from "@dankodeploy/shared";
import AdmZip from "adm-zip";

/** Маркер для проверки пароля при импорте (шифруется ключом из пароля). */
const VERIFIER_PLAINTEXT = "dankodeploy-backup";

/**
 * Имя файла экспорта: дата + время, чтобы различать бэкапы внутри одного дня.
 * Формат `dankodeploy-backup-YYYY-MM-DD_HH-MM-SS.zip` — без двоеточий (недопустимы
 * в именах файлов Windows и проблемны в HTTP Content-Disposition). Время — UTC (как
 * и createdAt в самом архиве), чтобы имя совпадало со штампом внутри.
 */
export function backupFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
  return `dankodeploy-backup-${stamp}.zip`;
}
/** Имя config.json и папки с файлами бэкапов внутри ZIP. */
const CONFIG_ENTRY = "config.json";
const BACKUPS_DIR_ENTRY = "backups";

/**
 * Какие таблицы входят в бэкап и какие их колонки — секреты (`*_enc`), которые
 * нужно перешифровывать. Порядок массива = порядок вставки при импорте (FK-safe:
 * ключи → серверы → проекты → деплои → env → backups).
 */
interface TableSpec {
  /** ключ в data бэкапа */
  key: keyof ConfigBackupData;
  /** имя таблицы в SQLite */
  table: string;
  /** колонка первичного ключа (цель ON CONFLICT) */
  pk: string;
  /** колонки-секреты (могут быть NULL) */
  secretCols: string[];
}

const TABLES: TableSpec[] = [
  { key: "sshKeys", table: "ssh_keys", pk: "id", secretCols: ["private_key_enc", "passphrase_enc"] },
  { key: "gitKeys", table: "git_keys", pk: "id", secretCols: ["private_key_enc", "passphrase_enc"] },
  { key: "servers", table: "servers", pk: "id", secretCols: ["secret_enc"] },
  { key: "projects", table: "projects", pk: "id", secretCols: [] },
  { key: "deployments", table: "deployments", pk: "id", secretCols: [] },
  { key: "projectEnv", table: "project_env", pk: "project_id", secretCols: ["content_enc"] },
  // backups — последней (FK на projects/deployments). Файлы артефактов в ZIP.
  { key: "backups", table: "backups", pk: "id", secretCols: [] },
];

/**
 * Экспорт/импорт конфигурации панели в ZIP (config.json + опц. файлы бэкапов).
 * Секреты перешифрованы под пароль экспорта (scrypt → AES-256-GCM), а не под
 * master-key — архив переносим между машинами. id строк сохраняются (FK-связи).
 */
export class ConfigBackupService {
  private readonly backupDirAbs: string;

  constructor(
    private readonly sqlite: SqliteDb,
    private readonly masterKey: Buffer,
    backupDir: string,
  ) {
    this.backupDirAbs = resolve(process.cwd(), backupDir);
    mkdirSync(this.backupDirAbs, { recursive: true });
  }

  /**
   * Собирает бэкап и упаковывает в ZIP. Возвращает буфер архива.
   * includeFiles=true — кладёт в архив сами файлы артефактов (.bak), а пути в
   * данных переписывает на портативные (backups/<имя>), чтобы импорт на другой
   * машине нашёл их в своём BACKUP_DIR.
   */
  export(password: string, includeFiles: boolean): { zip: Buffer; filename: string } {
    const salt = randomBytes(16);
    const exportKey = deriveKeyFromPassword(password, salt);

    const data = {} as ConfigBackupData;
    for (const spec of TABLES) {
      const rows = this.sqlite.prepare(`SELECT * FROM ${spec.table}`).all() as Record<
        string,
        unknown
      >[];
      data[spec.key] = rows.map((row) =>
        this.mapSecrets(row, spec.secretCols, this.masterKey, exportKey),
      );
    }

    const zip = new AdmZip();

    // Собираем файлы артефактов и переписываем пути в данных на относительные.
    let includedFiles = 0;
    if (includeFiles) {
      // Уникальные локальные пути из всех артефактов всех бэкапов.
      for (const row of data.backups) {
        rewriteBackupRowPaths(row, (absPath) => {
          if (!absPath || !existsSync(absPath)) return null;
          const name = basename(absPath);
          // Файл в архиве кладём один раз (имена уникальны: содержат backupId+artifact).
          if (!zip.getEntry(`${BACKUPS_DIR_ENTRY}/${name}`)) {
            zip.addFile(`${BACKUPS_DIR_ENTRY}/${name}`, readFileSync(absPath));
            includedFiles += 1;
          }
          return `${BACKUPS_DIR_ENTRY}/${name}`; // портативный путь в данных
        });
      }
    }

    const backup: ConfigBackup = {
      format: "dankodeploy-backup",
      version: 2,
      createdAt: new Date().toISOString(),
      kdf: { algo: "scrypt", salt: salt.toString("base64"), keylen: 32 },
      verifier: encryptSecret(VERIFIER_PLAINTEXT, exportKey),
      includesBackupFiles: includeFiles && includedFiles > 0,
      data,
    };

    zip.addFile(CONFIG_ENTRY, Buffer.from(JSON.stringify(backup, null, 2), "utf8"));

    return { zip: zip.toBuffer(), filename: backupFilename() };
  }

  /**
   * Импортирует бэкап из буфера: принимает ZIP (новый формат) или сырой JSON
   * (старый формат v1). Проверяет пароль, перешифровывает секреты под master-key,
   * восстанавливает файлы бэкапов на диск, делает upsert по id (FK-safe порядок).
   */
  import(password: string, fileBuffer: Buffer, mode: ImportMode): ImportResult {
    const { backup, zip } = this.parseFile(fileBuffer);

    const salt = Buffer.from(backup.kdf.salt, "base64");
    const exportKey = deriveKeyFromPassword(password, salt);

    // Проверка пароля: verifier должен расшифроваться в маркер. Иначе — стоп.
    try {
      if (decryptSecret(backup.verifier, exportKey) !== VERIFIER_PLAINTEXT) {
        throw new Error("mismatch");
      }
    } catch {
      throw new Error("Неверный пароль бэкапа");
    }

    const counts: ImportResult["counts"] = {
      sshKeys: 0,
      gitKeys: 0,
      servers: 0,
      projects: 0,
      deployments: 0,
      projectEnv: 0,
      backups: 0,
    };

    // Восстанавливаем файлы артефактов из ZIP на диск (в свой BACKUP_DIR) и
    // переписываем пути в данных на локальные абсолютные.
    let restoredFiles = 0;
    if (zip) {
      for (const row of backup.data.backups) {
        rewriteBackupRowPaths(row, (portablePath) => {
          if (!portablePath) return null;
          // В данных путь портативный (backups/<имя>) только если файл был вложен.
          const name = basename(portablePath);
          const entry = zip.getEntry(`${BACKUPS_DIR_ENTRY}/${name}`);
          if (!entry) return portablePath; // файла нет в архиве — оставляем как есть
          const dest = resolve(this.backupDirAbs, name);
          // writeFileSync через буфер записи: addLocalFile нельзя (вне cwd).
          zip.extractEntryTo(entry, this.backupDirAbs, /* maintainEntryPath */ false, true);
          restoredFiles += 1;
          return dest;
        });
      }
    }

    const run = this.sqlite.transaction(() => {
      if (mode === "replace") {
        // Удаляем в обратном FK-порядке (включая backups первой).
        for (const spec of [...TABLES].reverse()) {
          this.sqlite.prepare(`DELETE FROM ${spec.table}`).run();
        }
      }

      for (const spec of TABLES) {
        const rows = backup.data[spec.key] ?? [];
        for (const raw of rows) {
          const row = this.mapSecrets(raw, spec.secretCols, exportKey, this.masterKey);
          this.upsert(spec.table, spec.pk, row);
          counts[spec.key] += 1;
        }
      }
    });
    run();

    return { ok: true, mode, counts, restoredFiles };
  }

  /** Разбирает буфер: ZIP (config.json внутри) или сырой JSON. Валидирует схему. */
  private parseFile(buffer: Buffer): { backup: ConfigBackup; zip: AdmZip | null } {
    // ZIP начинается с сигнатуры PK\x03\x04.
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

    let json: unknown;
    let zip: AdmZip | null = null;
    if (isZip) {
      zip = new AdmZip(buffer);
      const entry = zip.getEntry(CONFIG_ENTRY);
      if (!entry) throw new Error("В архиве нет config.json — это не бэкап DankoDeploy");
      json = JSON.parse(zip.readAsText(entry));
    } else {
      json = JSON.parse(buffer.toString("utf8"));
    }

    const parsed = configBackupSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Файл не похож на бэкап конфигурации DankoDeploy");
    }
    return { backup: parsed.data, zip };
  }

  /** Перешифровывает указанные секретные колонки строки из одного ключа в другой. */
  private mapSecrets(
    row: Record<string, unknown>,
    secretCols: string[],
    from: Buffer,
    to: Buffer,
  ): Record<string, unknown> {
    const out = { ...row };
    for (const col of secretCols) {
      const val = out[col];
      if (typeof val === "string" && val.length > 0) {
        out[col] = encryptSecret(decryptSecret(val, from), to);
      }
    }
    return out;
  }

  /** INSERT … ON CONFLICT(pk) DO UPDATE по всем колонкам строки (upsert по PK). */
  private upsert(table: string, pk: string, row: Record<string, unknown>): void {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => "?").join(", ");
    const updates = cols
      .filter((c) => c !== pk)
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");
    const sql =
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders}) ` +
      (updates ? `ON CONFLICT(${pk}) DO UPDATE SET ${updates}` : `ON CONFLICT(${pk}) DO NOTHING`);
    this.sqlite.prepare(sql).run(cols.map((c) => row[c] as never));
  }
}

/**
 * Переписывает пути к файлам в строке таблицы backups через callback.
 * Затрагивает legacy-колонку `path` и пути внутри JSON-колонки `artifacts`.
 * map возвращает новый путь, либо null/исходный — если файла нет.
 */
function rewriteBackupRowPaths(
  row: Record<string, unknown>,
  map: (path: string | null) => string | null,
): void {
  if (typeof row.path === "string" && row.path) {
    const next = map(row.path);
    if (next) row.path = next;
  }
  if (typeof row.artifacts === "string" && row.artifacts) {
    try {
      const arts = JSON.parse(row.artifacts) as { path?: string }[];
      let changed = false;
      for (const a of arts) {
        if (typeof a.path === "string" && a.path) {
          const next = map(a.path);
          if (next && next !== a.path) {
            a.path = next;
            changed = true;
          }
        }
      }
      if (changed) row.artifacts = JSON.stringify(arts);
    } catch {
      /* битый JSON артефактов — пропускаем */
    }
  }
}
