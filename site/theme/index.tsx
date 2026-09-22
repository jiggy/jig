import { Layout as DefaultLayout, HomeLayout as DefaultHomeLayout, DocContent, HomeFooter, Link, useMdUrl } from '@rspress/core/theme-original'
import { Content, useFrontmatter, usePage, useSite } from '@rspress/core/runtime'
import { Arrow } from './icons'
import { Showcase, type ShowcaseData } from './showcase'
import { PackageShowcase, type PackageShowcaseData } from './package-showcase'
import '../landing.css'

export * from '@rspress/core/theme-original'
export { Search } from './search'
export { SwitchAppearance } from './appearance'
export { Tabs } from './tabs'
export { Sidebar } from './sidebar'
export { NavHamburger } from './navigation'

interface HomeData {
  hero: { name: string; text: string; tagline: string; eyebrow: string; status: string; statusLink: string; actions: { text: string; link: string; theme: string }[] }
  showcase: ShowcaseData | PackageShowcaseData
}

function HomeShowcase({ data }: { data: ShowcaseData | PackageShowcaseData }) {
  return data.kind === 'package' ? <PackageShowcase data={data} /> : <Showcase data={data} />
}

export function HomeLayout() {
  const { frontmatter } = useFrontmatter()
  const data = frontmatter as unknown as HomeData
  if (import.meta.env.SSG_MD) return <><DefaultHomeLayout /><HomeShowcase data={data.showcase} /><Content /></>
  return <>
    <main id="main-content" className="landing">
      <div className="landing-opening">
      <header className="hero">
        <div className="hero-field" aria-hidden="true"><div className="field-line" /><div className="field-line" /><div className="field-line" /><div className="field-core" /></div>
        <p className="eyebrow">{data.hero.eyebrow}</p>
        <h1>{data.hero.text.split('\n').map((line, index) => <span key={line} className={index ? 'hero-emphasis' : undefined}>{line}</span>)}</h1>
        <p className="hero-description">{data.hero.tagline}</p>
        <nav className="hero-actions" aria-label="Get started">{data.hero.actions.map(action => <Link key={action.link} href={action.link} className={`action action--${action.theme}`}>{action.text}<Arrow /></Link>)}</nav>
        <Link className="hero-status" href={data.hero.statusLink}><span aria-hidden="true" />{data.hero.status}</Link>
      </header>
      <HomeShowcase data={data.showcase} />
      </div>
      <div className="landing-content"><div className="product-story rp-doc"><DocContent isOverviewPage /></div></div>
    </main>
    <HomeFooter />
  </>
}

function DocContext() {
  const { page } = usePage()
  const path = page.routePath ?? ''
  const kind = path.startsWith('/spec/') ? 'Specification' : path.startsWith('/contracts/') ? 'Contract guide' : ['/use-cases', '/time-travel-handoff', '/orchestration-patterns'].some(route => path.startsWith(route)) ? 'Research' : 'Guide'
  if (import.meta.env.SSG_MD) return null
  return <div className="doc-context"><Link href="/guide/overview">Documentation</Link><span aria-hidden="true">/</span><span>{kind}</span><span className="doc-stage">Prerelease</span></div>
}

export function Layout() {
  const { site } = useSite()
  const { page } = usePage()
  const home = page.frontmatter?.pageType === 'home'
  const isCustom = page.frontmatter?.pageType === 'custom'
  return <div className="experience" data-product={site.title.toLowerCase()}>
    {!import.meta.env.SSG_MD && (home || isCustom) && <a className="skip-link" href="#main-content">Skip to content</a>}
    <DefaultLayout
      beforeDocContent={<DocContext />}
      bottom={isCustom ? <HomeFooter /> : undefined}
    />
  </div>
}

/** A direct resource link avoids an unnecessary dropdown for one action. */
export function LlmsViewOptions() {
  const { pathname } = useMdUrl()
  return <a className="rp-llms-button markdown-link" href={pathname}>View Markdown<Arrow /></a>
}
