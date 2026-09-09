import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type ComponentProps } from 'react'
import { Tabs as NativeTabs } from '@rspress/core/theme-original'

/** Retain Rspress's language persistence and Markdown export with keyboard tabs. */
export const Tabs = forwardRef<HTMLDivElement, ComponentProps<typeof NativeTabs>>((props, ref) => {
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  useImperativeHandle(ref, () => root.current!, [])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const labels = [...element.querySelectorAll<HTMLElement>(':scope > .rp-tabs__label > .rp-tabs__label__item')]
    element.querySelector(':scope > .rp-tabs__label')?.setAttribute('role', 'tablist')
    const update = () => labels.forEach((label, index) => {
      const selected = label.classList.contains('rp-tabs__label__item--selected')
      label.setAttribute('role', 'tab')
      label.setAttribute('aria-selected', String(selected))
      label.tabIndex = selected ? 0 : -1
      label.id = `${id}-tab-${index}`
      const panel = element.querySelector<HTMLElement>(`:scope > .rp-tabs__content > [data-index="${index}"]`)
      if (panel) {
        panel.id = `${id}-panel-${index}`
        panel.setAttribute('role', 'tabpanel')
        panel.setAttribute('aria-labelledby', label.id)
        label.setAttribute('aria-controls', panel.id)
      }
    })
    update()
    const observer = new MutationObserver(update)
    observer.observe(element, { childList: true, attributes: true, subtree: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [id, props.children])
  if (import.meta.env.SSG_MD) return <NativeTabs {...props} />
  return <div onKeyDown={event => {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'tab') return
    const tabs = [...target.parentElement!.querySelectorAll<HTMLElement>('[role="tab"]')]
    const index = tabs.indexOf(target)
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = tabs.length - 1
    if (event.key === 'Enter' || event.key === ' ') next = index
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    tabs[next].click()
    tabs[next].focus()
  }}><NativeTabs {...props} ref={root} /></div>
})
Tabs.displayName = 'Tabs'
