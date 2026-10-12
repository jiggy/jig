import { normalizeImagePath, useSite } from '@rspress/core/runtime'
import { Link } from '@rspress/core/theme-original'

/** Use a decorative emblem and one live, accessible product name. */
export function BrandTitle() {
  const { site } = useSite()
  const logo = site.logo
  const logoObject = typeof logo === 'object' && logo !== null ? logo : undefined
  const light = typeof logo === 'string' ? logo : logoObject?.light
  const dark = logoObject?.dark

  return (
    <div className="rp-nav__title">
      <Link href={site.logoHref || '/'} className="rp-nav__title__link">
        {(light || dark) && (
          <div className="rp-nav__title__logo" aria-hidden="true">
            {light && (
              <img
                src={normalizeImagePath(light)}
                alt=""
                className="rp-nav__title__logo-image rp-nav__title__logo-image--light"
              />
            )}
            {dark && (
              <img
                src={normalizeImagePath(dark)}
                alt=""
                className="rp-nav__title__logo-image rp-nav__title__logo-image--dark"
              />
            )}
          </div>
        )}
        <span>{site.logoText || site.title}</span>
      </Link>
    </div>
  )
}
