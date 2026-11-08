/** Native workbench navigation and actions; the host keeps its own return control. */
import { useState } from 'react'
import { ActionMenu, Button, Menu, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './toolbar.module.css'

/** Render author-owned navigation without moving content into the host through effects. */
export function WorkbenchToolbar({ title, breadcrumbs = [], status, actions = [], t }: FactoryComponentPropsOf<'actvero.workbench.toolbar'>) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const current = breadcrumbs.at(-1)
  return <div className={styles.toolbar} data-workbench-toolbar="">
    <nav className={styles.navigation} aria-label={t('businessNavigation')} data-has-path={breadcrumbs.length > 0 || undefined}>
      <div className={styles.trail}>
        {breadcrumbs.length ? <span className={styles.ancestor}>{title}</span> : <h1 className={styles.title}>{title}</h1>}
        {breadcrumbs.map((item, index) => <div className={styles.crumb} key={item.id}>
          <span className={styles.separator} aria-hidden="true">/</span>
          {index === breadcrumbs.length - 1 ? <h1 className={styles.title} aria-current="page">{item.label}</h1>
            : <Button size="sm" variant="ghost" disabled={!item.onSelect} onClick={item.onSelect}>{item.label}</Button>}
        </div>)}
      </div>
      {breadcrumbs.length > 0 && <Menu open={navigationOpen} onClose={() => { setNavigationOpen(false) }} portal autoFocus
        className={styles.navigationMenu} listClassName={styles.menu}
        anchor={<Button size="sm" className={styles.navigationTrigger} aria-label={t('businessNavigation')}
          aria-haspopup="menu" aria-expanded={navigationOpen} onClick={() => { setNavigationOpen(value => !value) }}>
          <span role="heading" aria-level={1}>{current?.label ?? title}</span><IconChevronDownOutlineRegular size={14} />
        </Button>}
        items={[{ id: 'workbench', label: title, disabled: true }, ...breadcrumbs.map(item => ({ id: `breadcrumb:${item.id}`, label: item.label,
          disabled: item === current || !item.onSelect }))]}
        onSelect={(id) => { setNavigationOpen(false); breadcrumbs.find(item => `breadcrumb:${item.id}` === id)?.onSelect?.() }} />}
    </nav>
    {status && <span className={styles.status} role={status.tone === 'error' ? 'alert' : 'status'}>{status.text}</span>}
    {actions.length > 0 && <div className={styles.actions}>
      <div className={styles.buttons}>{actions.map(action => <Button key={action.id} size="sm" variant="ghost"
        disabled={action.disabled} onClick={action.onSelect}>{action.label}</Button>)}</div>
      <ActionMenu label={t('businessActions')} className={styles.actionsMenu}
        items={actions.map(action => ({ id: action.id, label: action.label, disabled: action.disabled }))}
        onSelect={(id) => { actions.find(action => action.id === id)?.onSelect() }} />
    </div>}
  </div>
}
