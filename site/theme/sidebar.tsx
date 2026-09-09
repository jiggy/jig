import { useEffect, useId, useRef } from 'react'
import { Sidebar as NativeSidebar } from '@rspress/core/theme-original'

export function Sidebar() {
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    const element = root.current
    if (!element) return
    const update = () => {
      element.querySelectorAll<HTMLElement>('.rp-sidebar-group').forEach((group, index) => {
        const content = group.nextElementSibling as HTMLElement | null
        if (!content) return
        const expanded = content.style.gridTemplateRows !== '0fr'
        group.setAttribute('role', 'button')
        group.tabIndex = 0
        group.setAttribute('aria-expanded', String(expanded))
        content.id = `${id}-group-${index}`
        group.setAttribute('aria-controls', content.id)
        content.inert = !expanded
      })
      element.querySelectorAll('a').forEach(link => {
        if (link.classList.contains('rp-sidebar-item--active')) link.setAttribute('aria-current', 'page')
        else link.removeAttribute('aria-current')
      })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
    return () => observer.disconnect()
  }, [id])
  return <div ref={root} onKeyDown={event => {
    const target = event.target as HTMLElement
    if (event.key === 'Escape' && root.current?.closest('.rp-doc-layout__sidebar--open')) {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      document.querySelector<HTMLButtonElement>('.rp-sidebar-menu__left')?.focus()
      event.stopPropagation()
    }
    if (target.matches('.rp-sidebar-group') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      target.click()
    }
  }}><NativeSidebar /></div>
}
