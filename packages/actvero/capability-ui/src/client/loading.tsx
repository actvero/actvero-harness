import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './loading.module.css'
export function CatalogSkeleton({ label }:{ label:string }){return <div className={styles.grid} role="status" aria-label={label} aria-busy="true">{Array.from({ length:6 },(_,i)=><div key={i} className={styles.card} aria-hidden="true"><div className={styles.identity}><i/><span/></div><div className={styles.copy}><span/><span/></div><div className={styles.tags}><i/><i/><i/></div></div>)}</div>}
export function DetailLoading({ label }:{ label:string }){return <div className={styles.detail} role="status" aria-label={label}><StateDot state="ongoing" size={24}/></div>}
