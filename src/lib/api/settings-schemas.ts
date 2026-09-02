import { z } from "zod";
import { AI_PROVIDER_KINDS } from "@/lib/ai/settings";
import { LOCALES } from "@/lib/i18n/config";
import { THEMES } from "@/lib/theme/config";

/**
 * Validation for the settings endpoints.
 *
 * The API key is accepted but never echoed: it is write-only by construction,
 * because no response schema in the application contains it.
 */

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDER_KINDS),
  model: z.string().max(200).optional(),
  baseUrl: z.string().max(500).optional(),
  /** Empty/omitted means "keep the stored key"; deletion is a separate route. */
  apiKey: z.string().max(500).optional(),
  enabled: z.boolean(),
  scopeEvaluationEnabled: z.boolean(),
  changeAnalysisEnabled: z.boolean(),
  autoEvaluateNewScopes: z.boolean(),
  autoReevaluateChangedScopes: z.boolean(),
  heuristicFallbackEnabled: z.boolean(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().min(256).max(128_000).nullable().optional(),
});

export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export const preferencesSchema = z
  .object({
    locale: z.enum(LOCALES).optional(),
    theme: z.enum(THEMES).optional(),
  })
  .refine((value) => value.locale !== undefined || value.theme !== undefined, {
    message: "Provide at least one of locale or theme.",
  });
