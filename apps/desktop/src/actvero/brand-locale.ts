/** Keep native product copy aligned with the immutable build identity. */
import type { DesktopLocale } from '../locale.ts'
/**
 * Substitute the packaged product name without mutating either shipped dictionary.
 * @param locale - Selected built-in locale.
 * @param displayName - Build name, or undefined for the official baseline.
 * @returns Locale retaining every message and its original language.
 */
export function brandDesktopLocale(locale: DesktopLocale, displayName?: string): DesktopLocale {
  if (!displayName) return locale
  return { ...locale, messages: Object.fromEntries(Object.entries(locale.messages)
    .map(([key, value]) => [key, value.replaceAll('DeepSeek Harness', displayName)])) as DesktopLocale['messages'] }
}
