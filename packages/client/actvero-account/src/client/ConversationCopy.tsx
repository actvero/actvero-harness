import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ConversationCopy.module.css'

/** ACTVERO welcome copy, inheriting the native hero typography and theme. */
export function HeroHeading({ t }: PropsRuntime<'conversation.hero.heading'> & PropsLocale<'actvero.account'>) {
  return <h1 className={css.heading} data-actvero-hero-title>{t('heroHeadline')}</h1>
}

/** Running copy; Chat owns the clock, animation and stable live announcement. */
export function WorkingLabel({ duration, t }: PropsRuntime<'conversation.chat.running.label'> & PropsLocale<'actvero.account'>) {
  return <>{duration === undefined ? t('working') : t('workingFor', { duration })}</>
}
