import { z } from "zod";

import { projectPublicSchema, serviceStatusSchema } from "./project.js";

/**
 * Деплой — постоянная привязка проекта к серверу (проект × сервер). Создаётся во
 * вкладке «Деплои»; на него вешаются раскатки/бэкапы. Один проект можно развернуть
 * на несколько серверов — по одному деплою на каждый.
 */

/** Тело запроса на создание деплоя. */
export const createDeploymentSchema = z.object({
  projectId: z.string().min(1, "Выберите проект"),
  serverId: z.string().min(1, "Выберите сервер"),
});
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;

/** Публичное представление деплоя (без секретов). */
export const deploymentPublicSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  serverId: z.string(),
  /** Статус последней завершённой раскатки на этом сервере */
  lastDeployStatus: z.enum(["success", "failed", "running"]).nullable(),
  lastDeployAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeploymentPublic = z.infer<typeof deploymentPublicSchema>;

/**
 * Детальная сводка по деплою для вкладки: сам деплой + карточка проекта +
 * имя сервера + рантайм-статус сервиса (определяется по SSH в момент запроса).
 */
export const deploymentDetailSchema = z.object({
  deployment: deploymentPublicSchema,
  /** Карточка проекта (метаинформация, config, source) */
  project: projectPublicSchema,
  /** Имя сервера для отображения */
  serverName: z.string(),
  /** Текущий статус сервиса на сервере */
  status: serviceStatusSchema,
  /** Git-ревизия в workdir (если доступна) */
  gitRevision: z.string().nullable(),
  /** Версия/образ (docker image tag) */
  version: z.string().nullable(),
});
export type DeploymentDetail = z.infer<typeof deploymentDetailSchema>;
