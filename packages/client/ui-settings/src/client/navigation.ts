/** Navigation to feature-owned pages in the native settings shell. */
import type {} from '@deepseek-ai/cordis'

/** The settings shell provides this service only while its render seat is registered. */
export interface SettingsNavigation {
  /** Open a currently registered settings page without changing the active conversation.
   * @param sectionId Exact settings.section registration id.
   * @throws When the section or its owning shell has been disposed.
   */
  open(sectionId: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settingsNavigation: SettingsNavigation
  }
}
