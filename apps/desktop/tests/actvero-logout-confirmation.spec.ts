import { expect, it } from 'vitest'
import { logoutConfirmation } from '../src/actvero/logout-confirmation.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

it('uses localized choices and cancellation for close, Escape and the default response', () => {
  expect(logoutConfirmation(resolveDesktopLocale('zh-CN'))).toMatchInlineSnapshot(`
    {
      "buttons": [
        "退出登录",
        "取消",
      ],
      "cancelId": 1,
      "defaultId": 1,
      "detail": "退出后可重新登录。本机文件和对话会保留",
      "message": "确定退出当前账号？",
      "title": "退出登录",
    }
  `)
  expect(logoutConfirmation(resolveDesktopLocale('en'))).toMatchInlineSnapshot(`
    {
      "buttons": [
        "Sign out",
        "Cancel",
      ],
      "cancelId": 1,
      "defaultId": 1,
      "detail": "You can sign in again. Local files and conversations will be kept.",
      "message": "Sign out of this account?",
      "title": "Sign out",
    }
  `)
})
