/** 按住说话调用原生输入控件，录音与草稿仍由控件拥有。 */
import type { SessionId } from '@deepseek-ai/dsh-session'

/** 一次受 AbortSignal 管理的原生录音。 */
export interface VoiceHold {
  /** 松开后完成转写，通过原生输入提交或保留草稿。 */
  release(): Promise<void>
  /** 取消采集或转写，不能发送消息。 */
  cancel(): void
}

/** 已挂载原生录音控件提供的操作。 */
export interface VoiceControl {
  /** 开始本控件拥有的录音。
   * @param signal 生命周期取消信号。
   * @returns 当前会话的录音操作。
   */
  begin(signal: AbortSignal): Promise<VoiceHold>
}

/** 以原生会话定位录音控件，不创建另一套识别器。 */
export interface VoiceInputControls {
  /** 在原生输入控件中开始按住录音。
   * @param sessionId 按下时捕获的原生会话。
   * @param signal 取消信号。
   * @returns 录音操作。
   */
  begin(sessionId: SessionId, signal: AbortSignal): Promise<VoiceHold>
}

declare module '@deepseek-ai/cordis' {
  interface Context { voiceInputControls: VoiceInputControls }
}

/** 组件生命周期内注册；多个视图共享同一会话时使用最近挂载的控件。 */
export class VoiceControlRegistry implements VoiceInputControls {
  private readonly controls = new Map<SessionId, Set<VoiceControl>>()
  /** 挂载会话的语音控件。
   * @param id 会话。
   * @param control 挂载的控件。
   * @returns 撤销注册。
   */
  register(id: SessionId, control: VoiceControl): () => void {
    const controls = this.controls.get(id) ?? new Set<VoiceControl>()
    controls.add(control); this.controls.set(id, controls)
    return () => { controls.delete(control); if (!controls.size) this.controls.delete(id) }
  }
  /** 调用该会话最近挂载的语音控件。
   * @param sessionId 原生会话。
   * @param signal 取消信号。
   * @returns 录音操作。
   */
  async begin(sessionId: SessionId, signal: AbortSignal): Promise<VoiceHold> {
    signal.throwIfAborted()
    const controls = this.controls.get(sessionId)
    const control = controls && [...controls].at(-1)
    if (!control) throw new Error('voice_composer_unavailable')
    return await control.begin(signal)
  }
}
