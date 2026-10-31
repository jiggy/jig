import {
  Layout as DefaultLayout,
  HomeFooter,
  Link,
  useMdUrl,
} from '@rspress/core/theme-original'
import { Content, usePage, useSite } from '@rspress/core/runtime'
import { useEffect } from 'react'
import { Arrow } from './icons'
import { BrandTitle } from './brand-title'
import '../landing.css'

export * from '@rspress/core/theme-original'
export { Search } from './search'
export { SwitchAppearance } from './appearance'
export { Tabs } from './tabs'
export { Sidebar } from './sidebar'
export { NavHamburger } from './navigation'

/** Client-side documentation links return to the independently rendered home. */
export function HomeLayout() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && !import.meta.env.SSG_MD) {
      window.location.reload()
    }
  }, [])
  if (import.meta.env.SSG_MD) return <Content />
  return (
    <main id="main-content">
      <p><a href="/">Open the Jig landing page</a></p>
      <Content />
    </main>
  )
}

function DocContext() {
  const { page } = usePage()
  const path = page.routePath ?? ''
  const kind = path.startsWith('/spec/')
    ? 'Specification'
    : path.startsWith('/contracts/')
      ? 'Contract guide'
      : ['/use-cases', '/time-travel-handoff', '/orchestration-patterns'].some((route) =>
            path.startsWith(route),
          )
        ? 'Research'
        : 'Guide'
  if (import.meta.env.SSG_MD) return null
  return (
    <div className="doc-context">
      <Link href="/guide/overview">Documentation</Link>
      <span aria-hidden="true">/</span>
      <span>{kind}</span>
      <span className="doc-stage">Prerelease</span>
    </div>
  )
}

export function Layout() {
  const { site } = useSite()
  const { page } = usePage()
  const home = page.frontmatter?.pageType === 'home'
  const isCustom = page.frontmatter?.pageType === 'custom'
  return (
    <div className="experience" data-product={site.title.toLowerCase()}>
      {!import.meta.env.SSG_MD && (home || isCustom) && (
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
      )}
      <DefaultLayout
        navTitle={<BrandTitle />}
        beforeDocContent={<DocContext />}
        bottom={isCustom ? <HomeFooter /> : undefined}
      />
    </div>
  )
}

/** A direct resource link avoids an unnecessary dropdown for one action. */
export function LlmsViewOptions() {
  const { pathname } = useMdUrl()
  return (
    <a className="rp-llms-button markdown-link" href={pathname}>
      View Markdown
      <Arrow />
    </a>
  )
}
