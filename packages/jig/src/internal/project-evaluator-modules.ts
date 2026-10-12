/** Send a declaration subprocess only its captured transitive import graph. */
export function reachableAuthorModules<
  Module extends {
    readonly projectPath: string
    readonly imports: readonly { readonly projectPath: string }[]
  },
>(modules: readonly Module[], entryProjectPath: string): readonly Module[] {
  const byPath = new Map(modules.map((module) => [module.projectPath, module]))
  const reachable = new Set<string>()
  const pending = [entryProjectPath]
  while (pending.length > 0) {
    const path = pending.pop()!
    if (reachable.has(path)) continue
    reachable.add(path)
    for (const edge of byPath.get(path)!.imports) pending.push(edge.projectPath)
  }
  return modules.filter((module) => reachable.has(module.projectPath))
}
