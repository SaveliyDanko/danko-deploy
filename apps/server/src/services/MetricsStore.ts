import { type Db, metricsSnapshots } from "@dankodeploy/db";
import { type MetricsSnapshot, metricsSnapshotSchema } from "@dankodeploy/shared";
import { eq, sql } from "drizzle-orm";

/**
 * Разбирает JSON снимка ЧЕРЕЗ Zod-схему: применяет дефолты для новых полей
 * (`ports: []`, поля нагрузки контейнеров: null), поэтому старые снимки в БД,
 * сохранённые до добавления этих полей, нормализуются и не ломают фронт.
 */
function parseSnapshot(json: string): MetricsSnapshot | undefined {
  try {
    const parsed = metricsSnapshotSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Персистентное хранилище последнего снимка метрик каждого сервера (один ряд на сервер).
 * Дашборд читает их при загрузке и показывает мгновенно, не дожидаясь WS (stale-while-revalidate).
 */
export class MetricsStore {
  constructor(private readonly db: Db) {}

  /** Сохраняет/обновляет последний снимок сервера (upsert по server_id). */
  save(snapshot: MetricsSnapshot): void {
    this.db
      .insert(metricsSnapshots)
      .values({
        serverId: snapshot.serverId,
        snapshot: JSON.stringify(snapshot),
        collectedAt: snapshot.collectedAt,
      })
      .onConflictDoUpdate({
        target: metricsSnapshots.serverId,
        set: {
          snapshot: sql`excluded.snapshot`,
          collectedAt: sql`excluded.collected_at`,
        },
      })
      .run();
  }

  /** Возвращает последние сохранённые снимки всех серверов (битые/невалидные — отбрасываются). */
  listLatest(): MetricsSnapshot[] {
    return this.db
      .select()
      .from(metricsSnapshots)
      .all()
      .map((r) => parseSnapshot(r.snapshot))
      .filter((s): s is MetricsSnapshot => s !== undefined);
  }

  /** Последний снимок конкретного сервера (или undefined). */
  get(serverId: string): MetricsSnapshot | undefined {
    const row = this.db
      .select()
      .from(metricsSnapshots)
      .where(eq(metricsSnapshots.serverId, serverId))
      .get();
    return row ? parseSnapshot(row.snapshot) : undefined;
  }
}
