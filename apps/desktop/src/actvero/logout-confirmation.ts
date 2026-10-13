/** Main-owned localized sign-out confirmation using the desktop's existing dialog. */
import type { DesktopLocale } from '../locale.ts'
import type { UpdateDialogOptions } from '../update-dialog.ts'

const en = {
  title: 'Sign out',
  message: 'Sign out of this account?',
  detail: 'You can sign in again. Local files and conversations will be kept.',
}
const zh: typeof en = {
  title: '退出登录',
  message: '确定退出当前账号？',
  detail: '退出后可重新登录。本机文件和对话会保留',
}
/**
 * @param locale - Current desktop language, including its cancellation label.
 * @returns Main-owned choices; closing or escaping cancels sign-out.
 */
export function logoutConfirmation(locale: DesktopLocale): UpdateDialogOptions {
  const copy = locale.id === 'zh-CN' ? zh : en
  return { ...copy, buttons: [copy.title, locale.messages.cancel], cancelId: 1, defaultId: 1 }
}
