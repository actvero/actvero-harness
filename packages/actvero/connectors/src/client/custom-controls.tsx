import { useId, type ComponentProps, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Button, Input, IconChevronDownOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import s from './custom.module.css'

// DSH Input applies className to the outer span, which owns border and focus.
export function FieldInput({ className = '', ...props }: ComponentProps<typeof Input>) {
  return <Input {...props} className={`${s.input} ${className}`}/>
}

export function ChoiceSelect({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={s.select}><select {...props}>{children}</select><IconChevronDownOutlineMedium/></span>
}

export function Segmented<T extends string>({ label, value, options, onChange, disabled, kind = 'radio' }: {
  label: string; value: T; options: { value:T; label:ReactNode }[]
  onChange: (value:T)=>void; disabled?: boolean; kind?: 'radio'|'tabs'
}) {
  const id = useId()
  const tabs = kind === 'tabs'
  return <div className={tabs?s.tabs:s.segmented} role={tabs?'tablist':'radiogroup'} aria-label={label}>
    {options.map((option,index)=><Button key={option.value} type="button"
      id={tabs?`custom-mcp-tab-${option.value}`:`${id}-${option.value}`}
      role={tabs?'tab':'radio'} aria-selected={tabs?value===option.value:undefined}
      aria-checked={tabs?undefined:value===option.value} aria-controls={tabs?'custom-mcp-panel':undefined}
      tabIndex={value===option.value?0:-1} disabled={disabled}
      onClick={()=>onChange(option.value)} onKeyDown={(event)=>{
        const next = event.key==='ArrowRight'||event.key==='ArrowDown'?(index+1)%options.length:
          event.key==='ArrowLeft'||event.key==='ArrowUp'?(index+options.length-1)%options.length:
            event.key==='Home'?0:event.key==='End'?options.length-1:-1
        if(next<0)return
        event.preventDefault();onChange(options[next].value)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
      }}>{option.label}</Button>)}
  </div>
}
