/** Public skill presentation preference projected from the Host to the browser. */
import z from '@deepseek-ai/schemastery'

/** Host-owned skill presentation options. */
export interface Config {
  /** Use atomic neutral badges for menu picks while sending native /name gestures. */
  referenceChips: boolean
}

/** Validate the public presentation preference without changing ordinary DSH defaults. */
export const Config: z<Partial<Config>, Config> = z.object({
  referenceChips: z.boolean().default(false),
})

/** Browser boot key for public presentation options only. */
export const SKILL_CONFIG_GLOBAL = '__DSH_SKILL_PRESENTATION__'
declare global {
  var __DSH_SKILL_PRESENTATION__: Partial<Config> | undefined
}
