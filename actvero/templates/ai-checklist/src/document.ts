/** Persisted business data shared by the Host and its Client resource consumer. */
import { z } from 'zod'
/** Validate author-owned checklist documents at the persistence and resource readers. */
export const checklistDocument = z.object({ items: z.array(z.object({
  id: z.string(), text: z.string().min(1).max(2000), completed: z.boolean(),
}).strict()).max(1000) }).strict()
