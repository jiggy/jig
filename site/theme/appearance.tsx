import { useContext } from 'react'
import { ThemeContext } from '@rspress/core/runtime'
import { IconMoon, IconSun, SvgWrapper } from '@rspress/core/theme-original'

/** Native button semantics retain focus for keyboard use and menu dismissal. */
export function SwitchAppearance() {
  const { theme, setTheme } = useContext(ThemeContext)
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="rp-switch-appearance"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme?.(next)}
    >
      <SvgWrapper icon={theme === 'dark' ? IconMoon : IconSun} fill="currentColor" />
    </button>
  )
}
