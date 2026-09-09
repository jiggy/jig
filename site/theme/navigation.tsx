import { useEffect, useRef } from 'react'
import { useNav, useLocation } from '@rspress/core/runtime'
import { Link, SwitchAppearance } from '@rspress/core/theme-original'

/** A native disclosure keeps the small mobile menu usable without a modal. */
export function NavHamburger() {
  const items = useNav()
  const { pathname } = useLocation()
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => { if (menu.current) menu.current.open = false }, [pathname])
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  return <details ref={menu} className="compact-navigation" onKeyDown={event => {
    if (event.key === 'Escape') {
      menu.current!.open = false
      menu.current?.querySelector('summary')?.focus()
      event.stopPropagation()
    }
  }}>
    <summary aria-label="Navigation menu"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14" /></svg></summary>
    <nav aria-label="Mobile navigation">{items.map(item => 'link' in item && item.link ? <Link key={item.text} href={item.link}>{item.text}</Link> : null)}<div className="compact-navigation-theme"><span>Appearance</span><SwitchAppearance /></div></nav>
  </details>
}
