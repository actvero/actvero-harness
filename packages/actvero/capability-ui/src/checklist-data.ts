/** Business document validation shared by the checklist provider and its view. */
import { z } from 'zod'

/** Persisted checklist fields; legacy progress is imported once per business instance. */
export const checklistDocument = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string().trim().min(1).max(2000), completed: z.boolean() }).strict()).max(1000),
  legacyImported: z.boolean(),
}).strict()
