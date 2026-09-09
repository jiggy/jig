import { Layout as DefaultLayout, DocContent, Link } from '@rspress/core/theme-original'
import { useFrontmatter } from '@rspress/core/runtime'
import '../landing.css'

export * from '@rspress/core/theme-original'

export function HomeHero() {
  const { frontmatter } = useFrontmatter()
  const hero = frontmatter.hero
  return (
    <header className="product-hero">
      <p className="product-name">{hero.name}</p>
      <h1>{hero.text}</h1>
      <p className="product-tagline">{hero.tagline}</p>
      <nav className="product-actions" aria-label="Get started">
        {hero.actions.map((action: { link: string; text: string; theme: string }) => (
          <Link key={action.link} href={action.link} className={`product-action product-action--${action.theme}`}>
            {action.text}
          </Link>
        ))}
      </nav>
    </header>
  )
}

export function Layout() {
  return (
    <div onKeyDown={(event) => {
      // Rspress 2.0.21's closed search also handles document-level Enter.
      // Let native links activate without sending that key to the search listener.
      if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('a[href]')) {
        event.stopPropagation()
      }
    }}>
      <DefaultLayout afterFeatures={<main className="product-story rp-doc"><DocContent isOverviewPage /></main>} />
    </div>
  )
}
