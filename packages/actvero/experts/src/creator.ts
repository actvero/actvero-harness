import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/** Packaged authoring instructions use the validated expert persistence service. */
export const creatorSkill:SkillRegistration = {
  name:'expert-creator',
  description:'创建本地 ACTVERO 专家：梳理角色、工作方法、开场问题，选择已安装的技能和 MCP，并保存专家配置。',
  source:'bundled',
  invocation:{ modelInvocable:true,userInvocable:true },
  content:`# 创建 ACTVERO 本地专家

Only use this workflow when the user requests creation of an expert.
1. Clarify the expert's purpose, work method, expected deliverables and constraints. Ask only for information needed to write useful instructions.
2. Use expert_catalog to discover installed skills and configured MCP. Choose dependencies by exact ID, never by name alone. Do not invent IDs, install anything, enable services or request credentials.
3. Write a concise name and description, useful role instructions and 2–4 conversation starters. Required dependencies must be bound to available entries. If unavailable, explain what is missing; do not pretend the expert has that capability. Skill load is always for essential procedures, on_demand for supporting instructions.
4. Call expert_create with configuration JSON matching the shape below. This creates a new local expert and uses the strict expert schema validation. Do not write expert files with shell tools. Report success only after the tool succeeds. The user can open the result in the expert center and summon it.
5. Keep secrets, account IDs, access tokens and machine-specific paths out of manifest fields. bindings is a separate local map. Do not copy Skill bodies into the expert. Creating an expert does not grant privileges or bypass user tool approvals.

Example configuration (replace example dependency with actual catalog ID, or use empty arrays/maps):
{
  "manifest": {
    "schemaVersion": 1, "version": "1.0.0",
    "name": "周报助手", "description": "整理工作记录，形成简洁的周报。",
    "avatar": "", "category": "office", "tags": ["办公"],
    "instructions": "先收集本周成果、阻碍与下周计划，再整理为清晰周报。不编造工作成果。",
    "conversationStarters": ["把这些工作记录整理成周报"],
    "skills": [{"key":"report", "label":"周报技能", "required":true, "load":"always"}],
    "connectors": []
  },
  "bindings": {"skills":{"report":"EXACT_ID_FROM_CATALOG"},"connectors":{}}
}

schemaVersion is 1. category is office, engineering, design, content, data, education, lifestyle or general (default for older packages). Choose the closest category; tags describe specific capabilities. Recommend 3 concise, distinct tags, prioritizing the most useful ones; additional tags are allowed when needed (up to 8). version is three nonnegative integer components. name <=80 chars; description <=500; instructions <=64000; tags <=8 each <=30; starters <=6 each <=1000. Each dependency has key, label, required; skills additionally have load always/on_demand. Each key is unique within its kind. Only documented fields are accepted. IDs/revision are assigned by the service. Avatar may be empty; do not generate fake URLs.
`,
}
