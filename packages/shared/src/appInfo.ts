import { z } from "zod";

/** Версия реально запущенной сборки панели. */
export const appInfoSchema = z.object({
  version: z.string().min(1),
  commit: z
    .string()
    .regex(/^[a-f0-9]{7,40}$/)
    .nullable(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

export const healthResponseSchema = appInfoSchema.extend({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof healthResponseSchema>;
