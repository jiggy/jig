import { useEffect, useRef, useState } from 'react'
import { SearchPanel } from '@rspress/core/theme-original'
import { SearchIcon } from './icons'

export function Search() {
  const [focused, setFocused] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  function open() {
    returnFocus.current = document.activeElement as HTMLElement
    setFocused(true)
  }
  useEffect(() => {
    if (focused) {
      // Supply the modal semantics missing from Rspress 2.0.21's native panel.
      const panel = document.querySelector<HTMLElement>('.rp-search-panel__modal')
      panel?.setAttribute('role', 'dialog')
      panel?.setAttribute('aria-modal', 'true')
      panel?.setAttribute('aria-label', 'Search documentation')
      const input = panel?.querySelector('input')
      input?.setAttribute('aria-label', 'Search documentation')
      input?.setAttribute('role', 'combobox')
      input?.setAttribute('aria-autocomplete', 'list')
      const updateResults = () => {
        const results = panel?.querySelector('.rp-search-panel__results')
        const hasOptions = Boolean(results?.querySelector('a'))
        if (results && !hasOptions) results.setAttribute('role', 'status')
        input?.setAttribute('aria-expanded', String(hasOptions))
        if (results && hasOptions) {
          results.id = 'documentation-search-results'
          results.setAttribute('role', 'listbox')
          results.setAttribute('aria-label', 'Search results')
          input?.setAttribute('aria-controls', results.id)
          results.querySelectorAll('ul, li').forEach(item => item.setAttribute('role', 'presentation'))
          results.querySelectorAll('a').forEach((link, index) => {
            link.id = `documentation-search-result-${index}`
            link.setAttribute('role', 'option')
            link.setAttribute('aria-selected', String(Boolean(link.closest('.rp-suggest-item--current'))))
          })
          const selected = results.querySelector('[aria-selected="true"]')
          if (selected) input?.setAttribute('aria-activedescendant', selected.id)
          else input?.removeAttribute('aria-activedescendant')
        } else {
          input?.removeAttribute('aria-controls')
          input?.removeAttribute('aria-activedescendant')
        }
      }
      updateResults()
      const observer = new MutationObserver(updateResults)
      if (panel) observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
      for (const selector of ['.rp-search-panel__cancel', '.rp-search-panel__close']) {
        const control = panel?.querySelector<HTMLElement>(selector)
        control?.setAttribute('role', 'button')
        control?.setAttribute('tabindex', '0')
        control?.setAttribute('aria-label', selector.endsWith('cancel') ? 'Close search' : 'Clear query or close search')
      }
      const overflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { observer.disconnect(); document.body.style.overflow = overflow }
    }
    const shortcut = (event: KeyboardEvent) => {
      if (event.code === 'KeyK' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        open()
      }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [focused])
  function closeOrOpen(value: boolean) {
    setFocused(value)
    if (!value) (returnFocus.current ?? trigger.current)?.focus()
  }
  return <>
    <button ref={trigger} className="docs-search" aria-label="Search documentation" aria-haspopup="dialog" onClick={open}><SearchIcon /><span>Search documentation</span><kbd aria-hidden="true">⌘ K</kbd></button>
    {focused && <div onKeyDown={event => {
      const target = event.target as HTMLElement
      if (['Enter', ' '].includes(event.key) && target.matches('[role="button"]')) {
        event.preventDefault()
        event.stopPropagation()
        target.click()
      }
      // The native result handler assumes there is a selected result.
      if (['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key) && !document.querySelector('.rp-suggest-item--current a')) event.stopPropagation()
      if (event.key === 'Tab') {
        const controls = [...document.querySelectorAll<HTMLElement>('.rp-search-panel__modal input, .rp-search-panel__modal a, .rp-search-panel__modal button, .rp-search-panel__modal [tabindex="0"]')].filter(element => element.getClientRects().length)
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && target === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && target === last) { event.preventDefault(); first?.focus() }
      }
    }}><SearchPanel focused={focused} setFocused={closeOrOpen} /></div>}
  </>
}
