export const zh = {
  askAI: '请 AI 协助', task: '输入待办事项', add: '添加任务', loading: '正在读取…', models: '查看可用模型', modelsLoaded: '可用模型', noModels: '暂无可用模型', modelsFailed: '无法读取模型，请确认已登录并具有模型访问权限后重试。',
  section: '交付检查', scope: '确认需求和交付范围', materials: '整理项目资料', review: '检查交付内容',
  saved: '进度已保存在本机', saveFailed: '保存失败，请检查本机存储空间后重试。',
  readFailed: '无法读取已保存的进度，请检查本机存储后重新打开工作台。',
}
export const en: Record<keyof typeof zh, string> = {
  askAI: 'Ask AI', task: 'Enter a task', add: 'Add task', loading: 'Loading…', models: 'View available models', modelsLoaded: 'Available models', noModels: 'No models available', modelsFailed: 'Could not read models. Check your sign-in and model access, then retry.',
  section: 'Delivery checklist', scope: 'Confirm requirements and delivery scope', materials: 'Organize project materials', review: 'Review deliverables',
  saved: 'Progress saved on this device', saveFailed: 'Could not save. Check local storage and try again.',
  readFailed: 'Could not read saved progress. Check local storage and reopen the workbench.',
}
