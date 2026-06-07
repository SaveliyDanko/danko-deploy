import { type Db, type ProjectRow, projects } from "@dankodeploy/db";
import {
  type CreateProjectInput,
  type ProjectConfig,
  type ProjectPublic,
  type UpdateProjectInput,
} from "@dankodeploy/shared";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export function toProjectPublic(row: ProjectRow): ProjectPublic {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    stack: row.stack,
    description: row.description,
    config: JSON.parse(row.config) as ProjectConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * CRUD по проектам-карточкам (без привязки к серверу). Раскатка/бэкапы/статус —
 * через деплои (см. DeploymentService).
 */
export class ProjectService {
  constructor(private readonly db: Db) {}

  list(): ProjectPublic[] {
    return this.db.select().from(projects).all().map(toProjectPublic);
  }

  getRow(id: string): ProjectRow | undefined {
    return this.db.select().from(projects).where(eq(projects.id, id)).get();
  }

  get(id: string): ProjectPublic | undefined {
    const row = this.getRow(id);
    return row ? toProjectPublic(row) : undefined;
  }

  create(input: CreateProjectInput): ProjectPublic {
    const id = nanoid();
    this.db
      .insert(projects)
      .values({
        id,
        name: input.name,
        kind: input.kind,
        stack: input.stack ?? null,
        description: input.description ?? null,
        config: JSON.stringify(input.config),
      })
      .run();
    return toProjectPublic(this.getRow(id)!);
  }

  update(id: string, input: UpdateProjectInput): ProjectPublic | undefined {
    const existing = this.getRow(id);
    if (!existing) return undefined;
    const patch: Partial<ProjectRow> = { updatedAt: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.stack !== undefined) patch.stack = input.stack ?? null;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.config !== undefined) patch.config = JSON.stringify(input.config);
    this.db.update(projects).set(patch).where(eq(projects.id, id)).run();
    return toProjectPublic(this.getRow(id)!);
  }

  delete(id: string): boolean {
    const res = this.db.delete(projects).where(eq(projects.id, id)).run();
    return res.changes > 0;
  }
}
