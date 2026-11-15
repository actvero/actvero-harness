/** 原生专家选择器向其他客户端插件提供的窄范围操作。 */
import type { SessionId } from '@deepseek-ai/dsh-session'

/** 可绑定到快捷入口的专家，不包含提示词、凭据或依赖配置。 */
export interface ExpertShortcut { id: string; name: string; avatar: string }

/** 复用原生授权、依赖准备和会话导航。 */
export interface ExpertLauncher {
  /** 读取可绑定快捷入口的专家。
   * @returns 当前可选择的本地专家与最近使用专家。
   */
  list(): Promise<ExpertShortcut[]>
  /** 恢复同工作区最近会话，或走原生专家选择流程。
   * @param expertId 已授权专家 ID。
   * @param fromSession 当前主会话，用于确定工作区。
   * @param signal 取消导航和后续选择。
   */
  activate(expertId: string, fromSession: SessionId, signal: AbortSignal): Promise<void>
}

/** 专家快捷入口使用的原生目录、会话与导航操作。 */
export interface ExpertLauncherSource {
  /** 读取当前目录。
   * @returns 当前允许选择的专家。
   */
  list(): Promise<ExpertShortcut[]>
  /** 读取当前工作区的会话。
   * @param fromSession 当前会话。
   * @returns 同工作区候选，工作区缺失时返回 undefined。
   */
  candidates(fromSession: SessionId): readonly { id: SessionId; updatedAt: number }[] | undefined
  /** 读取历史专家选择。
   * @param sessionId 候选会话。
   * @returns 原生持久化专家选择。
   */
  selection(sessionId: SessionId): Promise<{ id: string } | null>
  /** 打开历史会话。
   * @param sessionId 已确认的同工作区会话。
   */
  open(sessionId: SessionId): void
  /** 使用原生召唤流程。
   * @param expertId 专家。
   * @param fromSession 原会话。
   * @param signal 取消信号。
   */
  summon(expertId: string, fromSession: SessionId, signal: AbortSignal): Promise<void>
}

/** 创建带最近会话恢复与取消检查的原生专家入口。
 * @param source 原生服务操作；候选必须来自当前会话所属工作区。
 * @returns 专家目录与激活操作。
 */
export function createExpertLauncher(source: ExpertLauncherSource): ExpertLauncher {
  return {
    list: () => source.list(),
    activate: async (expertId, fromSession, signal) => {
      signal.throwIfAborted()
      const candidates = source.candidates(fromSession)
      if (!candidates) throw new Error('expert_workspace_missing')
      const catalog = await source.list()
      signal.throwIfAborted()
      if (!catalog.some(expert => expert.id === expertId)) throw new Error('expert_remote_unavailable')
      for (const previous of [...candidates].sort((a, b) => b.updatedAt - a.updatedAt)) {
        signal.throwIfAborted()
        const selected = await source.selection(previous.id)
        signal.throwIfAborted()
        if (selected?.id === expertId) { source.open(previous.id); return }
      }
      await source.summon(expertId, fromSession, signal)
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { actveroExpertLauncher: ExpertLauncher }
}
