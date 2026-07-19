import { z } from "zod";

export const authMeSchema = z.object({
  authenticated: z.boolean(),
  authRequired: z.boolean(),
  twoFactorRequired: z.boolean(),
});
export type AuthMe = z.infer<typeof authMeSchema>;

export const loginInputSchema = z.object({
  password: z.string().min(1),
  code: z.string().trim().max(32).optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  pendingSetup: z.boolean(),
});
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;

export const twoFactorPasswordInputSchema = z.object({
  password: z.string().min(1),
});
export type TwoFactorPasswordInput = z.infer<typeof twoFactorPasswordInputSchema>;

export const twoFactorCodeInputSchema = z.object({
  password: z.string().min(1),
  code: z.string().trim().min(1).max(32),
});
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeInputSchema>;

export const twoFactorSetupSchema = z.object({
  secret: z.string(),
  qrCodeDataUrl: z.string(),
});
export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>;

export const recoveryCodesSchema = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()),
});
export type RecoveryCodes = z.infer<typeof recoveryCodesSchema>;
