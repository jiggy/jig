import { access } from 'node:fs/promises'

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

export { exists }
