/** Localized entry and portable instructions for designing an expert outside Harness. */
export const creatorZh = {
  creatorHelp: '告诉 AI 你的工作场景，一起确定专家的职责和工作方法。',
  creatorChoice: '在 Harness 中开始，或复制创建说明交给其他 Agent。',
  creatorHere: '在 Harness 中创建',
  creatorElsewhere: '交给其他 Agent',
  creatorCopied: '已复制创建说明，粘贴给其他 Agent 即可',
  creatorCopyFailed: '复制失败，请允许剪贴板访问后重试',
  creatorHandoff: `请帮我设计一个可导入 ACTVERO Harness 的专家。

先利用我已提供的信息，了解工作场景、输入材料、输出对象和质量标准，并取得一个真实任务示例。关键需求不明确时，先提问并等待我的回答，不凭角色名称生成完整专家。给出职责、工作流程、所需能力和试用任务，与我对齐后再生成文件。若有实际可用的图像生成工具，询问是否需要头像，沿用我已作出的选择。

交付一个 ExpertManifest v1 JSON 文件，不是已保存专家记录，也不需要编写程序。字段如下：schemaVersion 固定为 1；id 为不超过 80 字符的英文字母、数字、下划线或连字符；version 为三段数字版本号；name 最多 80 字符；description 最多 500 字符；instructions 为确认后的工作指令，最多 64000 字符；tags 为最多 8 项的字符串数组，每项最多 30 字符；conversationStarters 为最多 6 项的字符串数组。category 使用 office、engineering、design、content、data、education、lifestyle 或 general。avatar 留空，或使用实际生成的 PNG、JPEG、WebP 的 base64 data URL，最多 500000 字符。

skills 和 connectors 都是依赖声明数组，每项包含 key、label、required；skills 每项还需 load，值为 always 或 on_demand。key 只用英文字母、数字、下划线或连字符，同类数组内不能重复。不要编造本机资源 ID 或写入 bindings。不需要依赖时使用空数组；无法核实依赖时说明待确认的能力，不把它说成已就绪。

文件生成后，引导我到“能力中心 → 专家 → 导入专家”，核对声明并绑定本机技能和 MCP，再用真实任务试用。没有在客户端完成导入前，不声称专家已保存；没有实际试跑前，不声称试用通过。`,
}

export const creatorEn: Record<keyof typeof creatorZh, string> = {
  creatorHelp: 'Tell AI about your work and define the expert’s responsibilities and methods together.',
  creatorChoice: 'Start in Harness or copy the creation instructions for another Agent.',
  creatorHere: 'Create in Harness',
  creatorElsewhere: 'Use another Agent',
  creatorCopied: 'Creation instructions copied. Paste them into your other Agent.',
  creatorCopyFailed: 'Could not copy. Allow clipboard access and try again.',
  creatorHandoff: `Help me design an expert that can be imported into ACTVERO Harness.

Use the information I have already provided to understand my work, inputs, audience, quality criteria and one real task example. Ask about missing critical requirements and wait for my answers. A role name alone is not a complete brief. Align the responsibilities, workflow, dependencies and trial task with me before producing a file. If an image-generation tool is actually available, offer an avatar and honor any choice I have already made.

Deliver one ExpertManifest v1 JSON file, not a saved expert record or a program. Fields: schemaVersion is 1; id uses up to 80 letters, digits, underscores or hyphens; version has three numeric components; name is at most 80 characters; description at most 500; instructions contains the agreed workflow, at most 64000 characters; tags is an array of at most 8 strings of up to 30 characters; conversationStarters is an array of at most 6 strings. category is office, engineering, design, content, data, education, lifestyle or general. avatar is empty or an actual generated PNG, JPEG or WebP base64 data URL of at most 500000 characters.

skills and connectors are dependency declaration arrays. Each entry has key, label and required; skill entries also have load set to always or on_demand. Keys use letters, digits, underscores or hyphens and are unique within each array. Do not invent local resource IDs or include bindings. Use empty arrays when no dependencies are needed; identify unverified capabilities without claiming they are ready.

After delivering the file, direct me to Capability center → Experts → Import expert, review the declarations and bind local skills and MCP connections, then try a real task. Do not claim the expert is saved before import or that a trial passed before actually running it.`,
}
