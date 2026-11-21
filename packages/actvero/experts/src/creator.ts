import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSkill } from '@actvero/dsh-skills/package'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { creatorSkillName } from './creator-name.ts'

export { creatorSkillName } from './creator-name.ts'

/** Physical resource directory supplied by Desktop, or the source package's bundled files. */
export const creatorSkillDirectory = process.env.ACTVERO_EXPERT_CREATOR_DIR
  ? resolve(process.env.ACTVERO_EXPERT_CREATOR_DIR)
  : fileURLToPath(new URL('./assets/expert-creator', import.meta.resolve('@actvero/dsh-experts/package.json')))

/** The skill tool exposes this directory so Agents can read references and run bundled scripts. */
export const creatorSkill: SkillRegistration = {
  ...parseSkill(readFileSync(join(creatorSkillDirectory, 'SKILL.md'), 'utf8'), creatorSkillName),
  resourceBase: { kind: 'directory', path: creatorSkillDirectory },
  source: 'bundled',
}
