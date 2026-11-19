/** Localized entry and portable instructions for designing an expert outside Harness. */
export const creatorZh = {
  creatorResources: '专家创建 Skill：{skillPath}\n本机 Harness 开发连接：{connectionPath}\n随 Harness 安装的 CLI 调用：{cliInvocation}\n使用其中的 executable、args 和单次进程 env，追加 expert 操作直接创建、读取、更新和检查目标 Harness 中的本机专家。',
  creatorHelp: '告诉 AI 你的工作场景，一起确定专家的职责和工作方法。',
  creatorChoice: '在 Harness 中开始，或复制创建说明交给其他 Agent。',
  creatorHere: '在 Harness 中创建',
  creatorElsewhere: '交给其他 Agent',
  creatorCopied: '已复制创建说明，粘贴给其他 Agent 即可',
  creatorCopyFailed: '复制失败，请允许剪贴板访问后重试',
  creatorHandoff: `请帮我创建或改造一个 ACTVERO 专家。先读取下方提供的完整 expert-creator Skill，沿用我已提供的信息；关键需求不明确时，先提问并等待我的回答，再确认职责、工作流程和试用任务。实际有图像生成工具时询问是否需要头像。

使用下方连接文件定位目标 Harness，通过 actvero-workbench expert 命令查询本机能力、创建或更新专家，再回读和检查。只做已授权的本机维护，不默认上传或发布。保存、依赖就绪和真实试用分别报告。

不能连接时交付 ExpertManifest v1 JSON，明确尚未保存；引导我到“能力中心 → 专家 → 导入专家”核对和绑定本机能力。`,
}

export const creatorEn: Record<keyof typeof creatorZh, string> = {
  creatorResources: 'Expert creation Skill: {skillPath}\nLocal Harness development connection: {connectionPath}\nCLI installed with Harness: {cliInvocation}\nUse the executable, args and per-process env, then append expert operations to create, read, update and check local experts in this Harness.',
  creatorHelp: 'Tell AI about your work and define the expert’s responsibilities and methods together.',
  creatorChoice: 'Start in Harness or copy the creation instructions for another Agent.',
  creatorHere: 'Create in Harness',
  creatorElsewhere: 'Use another Agent',
  creatorCopied: 'Creation instructions copied. Paste them into your other Agent.',
  creatorCopyFailed: 'Could not copy. Allow clipboard access and try again.',
  creatorHandoff: `Help me create or improve an ACTVERO expert. Read the complete expert-creator Skill below and use the information already provided. Ask about missing critical requirements and wait for my reply before aligning responsibilities, workflow and a trial task. Offer an avatar when an image generator is actually available.

Use the connection file below to address the target Harness. Run actvero-workbench expert operations to inspect local capabilities, create or update the expert, then read it back and check dependencies. Perform authorized local maintenance without assuming upload or publication. Report saving, dependency readiness and actual trials separately.

If the connection is unavailable, deliver ExpertManifest v1 JSON and state that it has not been saved. Direct me to Capability center → Experts → Import expert to review and bind local capabilities.`,
}
