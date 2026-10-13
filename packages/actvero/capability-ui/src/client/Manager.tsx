import { zh,en } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { selectors } from './selectors.ts'
import { type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime, PropsLocale, PropsRenderSlots, PropsHooks } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback,useEffect,useState } from 'react'
import { Toast,IconWarningOutlineRegular,Button,IconChevronLeftOutlineMedium,IconAgentPresetOutlineMedium,IconSkillOutlineMedium,IconLinkOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityTab,CapabilityBackNavigation } from '../contracts.ts'
import styles from './hub.module.css'
declare module '@deepseek-ai/dsh-client-ui-slots'{interface LocaleNamespaceMap{ 'actvero.hub':keyof typeof zh }}
interface Notice { text:string;tone?:'success';seq:number }
function CapabilityToast({ useNotice,dismiss }:PropsHooks<{ notice:{ getSnapshot:()=>Notice|null;subscribe:(fn:()=>void)=>()=>void } }>&{ dismiss:()=>void }){const notice=useNotice(v=>v);return notice?<Toast key={notice.seq} text={notice.text} tone={notice.tone} icon={<IconWarningOutlineRegular/>} onDone={dismiss}/>:null}
class Hub {
  private notice:Notice|null=null;private noticeSequence=0;private noticeListeners=new Set<()=>void>()
  noticeSnapshot=()=>this.notice;noticeSubscribe=(fn:()=>void)=>{this.noticeListeners.add(fn);return()=>{this.noticeListeners.delete(fn)}}
  dismiss=()=>{this.notice=null;for(const fn of this.noticeListeners)fn()}
  notify=(text:string,tone?:'success')=>{this.notice={ text,...(tone?{ tone }:{}),seq:++this.noticeSequence };for(const fn of this.noticeListeners)fn()}
  private selected:CapabilityTab='experts';private listeners=new Set<()=>void>()
  constructor(private ctx:Context){}
  getSnapshot=()=>this.selected
  reset=()=>{this.selected='experts';for(const fn of this.listeners)fn()}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  open(tab:CapabilityTab){this.selected=tab;for(const fn of this.listeners)fn();this.ctx.layout.selectPanel('actvero-capabilities' as MainPanelId)}
}
function Panel({ renderSlot,t,useSelected,open,reset,notify }:PropsRuntime<'main'>&PropsRenderSlots<'actvero.capability.content'>&PropsLocale<'actvero.hub'>&PropsHooks<{ selected:{ getSnapshot:()=>CapabilityTab;subscribe:(fn:()=>void)=>()=>void } }>&{ open:(tab:CapabilityTab)=>void;reset:()=>void;notify:(text:string,tone?:'success')=>void }){
  const selected=useSelected(value=>value)
  useEffect(()=>()=>reset(),[reset])
  const [navigation,setNavigation]=useState<(CapabilityBackNavigation&{ tab:CapabilityTab })>()
  const setBackNavigation=useCallback((value:CapabilityBackNavigation|undefined)=>setNavigation(current=>value?{ ...value,tab:selected }:current?.tab===selected?undefined:current),[selected])
  const back=navigation?.tab===selected?navigation:undefined
  const tabIds=['experts','skills','connectors'] as const
  return <section className={styles.page}>
    <div className={styles.navigation}>{back?<Button autoFocus id="capability-back" className={styles.back} variant="ghost" onClick={back.onBack}><IconChevronLeftOutlineMedium/>{back.label}</Button>:<div className={styles.tabs} role="tablist" aria-label={t('hub')}>
      {tabIds.map((tab,i)=>{const Icon=tab==='experts'?IconAgentPresetOutlineMedium:tab==='skills'?IconSkillOutlineMedium:IconLinkOutlineMedium
        return <Button key={tab} id={`capability-${tab}`} role="tab" aria-controls="capability-content" aria-selected={selected===tab} tabIndex={selected===tab?0:-1} variant={selected===tab?'primary':'ghost'} onClick={()=>open(tab)} onKeyDown={(event)=>{const next=event.key==='ArrowRight'?(i+1)%3:event.key==='ArrowLeft'?(i+2)%3:event.key==='Home'?0:event.key==='End'?2:-1;if(next<0)return;event.preventDefault();open(tabIds[next]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()}}><Icon/>{t(tab)}</Button>})}
    </div>}</div>
    <div className={styles.content} role="tabpanel" id="capability-content" aria-labelledby={back?'capability-back':`capability-${selected}`}>
      {renderSlot('actvero.capability.content',{ setBackNavigation,notify }, { entryKey:selected,fallback:<div className={styles.empty}>{t('upcoming')}</div> })}
    </div>
  </section>
}
export const inject=['slots','locale','layout','commandUi','sessions','conversation','remote','remote.skills']
export function apply(ctx:Context){
  const scope=ctx
  {
    const hub=new Hub(scope);scope.effect(()=>scope.reflect.provide('capabilityHub',hub))
    scope.effect(()=>scope.locale.register('actvero.hub',{ zh,en }));const t=scope.locale.bind('actvero.hub')
    scope.slots.inject('sidebar.panellist',()=>scope.slots.register({ name:'sidebar.panellist',id:'actvero-capabilities' as MainPanelId,order:40,label:()=>t('hub') },()=> <span className={styles.sidebarEntryIcon}><IconSkillOutlineMedium/></span>))
    selectors(scope)
    scope.slots.inject('shell.overlay',()=>scope.slots.register({ name:'shell.overlay',id:'actvero-capability-toast',inject:()=>({ hooks:{ notice:{ getSnapshot:hub.noticeSnapshot,subscribe:hub.noticeSubscribe } },dismiss:hub.dismiss }) },CapabilityToast))
    scope.slots.inject('main',()=>scope.slots.register({ name:'main',key:'actvero-capabilities' as MainPanelId,locale:'actvero.hub',children:{ 'actvero.capability.content':{ kind:'keyed',scope:'root' } },inject:()=>({ hooks:{ selected:{ getSnapshot:hub.getSnapshot,subscribe:hub.subscribe } },reset:hub.reset,notify:hub.notify,open:(tab:CapabilityTab)=>hub.open(tab) }) },Panel))
  }
}
