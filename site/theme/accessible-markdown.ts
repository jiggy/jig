// Make generated section links and scrollable tables accessible.
type Element = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: Element[]
}

export function accessibleMarkdown() {
  return (tree: Element) => {
    const text = (node: Element): string => node.value ?? (node.children ?? []).map(text).join('')
    const walk = (node: Element) => {
      if (node.tagName === 'table') {
        node.properties ??= {}
        node.properties.tabIndex = 0
      }
      if (/^h[1-6]$/.test(node.tagName ?? '')) {
        const anchor = node.children?.find(child => child.tagName === 'a' && child.properties?.ariaHidden === 'true')
        if (anchor?.properties) {
          delete anchor.properties.ariaHidden
          anchor.properties.ariaLabel = `Link to section: ${(node.children ?? []).filter(child => child !== anchor).map(text).join('')}`
        }
      }
      node.children?.forEach(walk)
    }
    walk(tree)
  }
}
