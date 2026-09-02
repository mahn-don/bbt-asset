import { z } from "zod";
import { ASSET_TYPES } from "@/lib/enums";

/** Body for POST /api/ai-supporter/generate. */
export const generateSchema = z.object({
  focus: z.array(z.enum(ASSET_TYPES)).max(ASSET_TYPES.length).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
