import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Rspress has already converted local Markdown images into MDX imports here.
// Keep its image component (including zoom) and leave Markdown export untouched.
export function diagramImages() {
  return (tree: any, file: { path: string }) => {
    const variants = new Map<string, string[]>()
    const imports: any[] = []
    for (const node of tree.children) {
      const declaration = node.data?.estree?.body?.[0]
      const source = declaration?.source?.value
      if (declaration?.type !== 'ImportDeclaration' || typeof source !== 'string' ||
          !source.startsWith('.') || !source.endsWith('.svg')) continue
      const svg = readFileSync(resolve(dirname(file.path), source), 'utf8')
      if (!svg.includes('Archify renderer notice') || !svg.includes('prefers-color-scheme')) continue
      const identifier = declaration.specifiers[0].local.name
      variants.set(identifier, ['light', 'dark'].map(theme => {
        const copy = structuredClone(node)
        const name = `${identifier}_${theme}`
        const path = `${source}?diagram-theme=${theme}`
        const statement = copy.data.estree.body[0]
        statement.specifiers[0].local.name = name
        statement.source.value = path
        statement.source.raw = JSON.stringify(path)
        copy.value = `import ${name} from ${JSON.stringify(path)}`
        imports.push(copy)
        return name
      }))
    }
    const walk = (node: any) => {
      if (!node.children) return
      node.children = node.children.flatMap((child: any) => {
        const src = child.name === 'img' && child.attributes?.find((attr: any) => attr.name === 'src')
        const names = variants.get(src?.value?.value)
        if (!names) { walk(child); return [child] }
        return names.map((name, index) => {
          const image = structuredClone(child)
          const attribute = image.attributes.find((attr: any) => attr.name === 'src')
          attribute.value.value = name
          attribute.value.data.estree.body[0].expression.name = name
          // Retain the original asset referenced by the generated Markdown.
          image.attributes.push({ type: 'mdxJsxAttribute', name: 'data-diagram-source', value: structuredClone(src.value) })
          image.attributes.push({ type: 'mdxJsxAttribute', name: 'data-diagram-theme', value: index ? 'dark' : 'light' })
          return image
        })
      })
    }
    walk(tree)
    tree.children.unshift(...imports)
  }
}
