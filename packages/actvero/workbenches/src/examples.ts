/** Explicitly labelled local reference workbenches for the first host preview. */
import { z } from 'zod'
import { workbenchIdSchema, type WorkbenchData } from './contracts.ts'
import type { WorkbenchProvider } from './contracts.ts'

/** Stable identifier of the bundled creative reference application. */
export const CREATIVE_ID = workbenchIdSchema.parse('@actvero/example-creative')
/** Stable identifier of the bundled asset-notes reference application. */
export const LIBRARY_ID = workbenchIdSchema.parse('@actvero/example-library')
const node = z.object({ id: z.string().min(1).max(80), kind: z.enum(['text', 'image', 'video']), title: z.string().min(1).max(200), text: z.string().max(12000) })
/** Validate editable creative nodes from durable records or model tools. */
export const creativeSchema = z.object({ nodes: z.array(node).min(1).max(60) })
/** Validate asset notes from durable records or model tools. */
export const librarySchema = z.object({ notes: z.string().max(20000) })
/** Create the bundled reference providers without invoking models or network services.
 * @returns Providers with independent validation and initial local data. */
export function exampleProviders(): WorkbenchProvider[] {
  return [
    {
      descriptor: { id: CREATIVE_ID, packageName: '@actvero/dsh-workbenches', title: '图文视频创作示例', description: '整理创意、编排分镜，与 AI 一起调整内容。', version: '0.1.0', icon: 'canvas', example: true },
      initialData: () => ({ nodes: [
        { id: 'script', kind: 'text', title: '创意脚本', text: '秋季徒步，轻装出发。\n在金色的山林间，背上全新的户外徒步背包，轻盈坚固，从城市走向自然，遇见更广阔的秋天。' },
        { id: 'visual', kind: 'image', title: '产品主视觉', text: '橄榄绿徒步背包，森林岩石，自然柔光。' },
        { id: 'storyboard', kind: 'video', title: '视频分镜', text: '镜头 1：背包细节特写。\n镜头 2：森林徒步场景。\n镜头 3：山脊远景，展示产品与自然的联系。' },
      ] }),
      validateData: data => creativeSchema.parse(data),
      instructions: 'You are a creative workbench assistant. Help edit the current project script, visual description and storyboard. Read current data using actvero_workbench_read before changes, then call actvero_workbench_update with the returned revision and the complete JSON data. Keep node ids and kinds stable. Existing product photographs are illustrative assets; changing text does not generate a new image or video. Never claim media generation or publication has completed.',
    },
    {
      descriptor: { id: LIBRARY_ID, packageName: '@actvero/dsh-workbenches', title: '本地素材示例', description: '查看参考素材并记录说明，无需先创建项目或对话。', version: '0.1.0', icon: 'files', example: true },
      initialData: () => ({ notes: '' }),
      validateData: (data: WorkbenchData) => librarySchema.parse(data),
      instructions: 'Help organize notes for the current reference asset. Use actvero_workbench_read to read the latest state and actvero_workbench_update to update notes with its revision. The displayed photograph is a reference asset; do not claim to import or generate other assets.',
    },
  ]
}
