import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkExampleProject } from './check-example-project.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-example-source-'))
  await mkdir(join(root, 'bindings'))
  await mkdir(join(root, 'flows/echo'), { recursive: true })
  // Inert source inputs test the checker and compiler, not Jig admission.
  await writeFile(join(root, 'jig.ts'), "export default {entrypoint:'binding:echo'}\n")
  await writeFile(
    join(root, 'bindings/echo.ts'),
    "export default {kind:'package',package:'flows/echo'}\n",
  )
  await writeFile(join(root, 'flows/echo/FLOW.ts'), "export const message = 'hello'\n")
  return root
}

test('source smoke imports declarations and compiles real files without executing a Flow', async () => {
  const root = await fixture()
  try {
    await writeFile(
      join(root, 'flows/echo/FLOW.ts'),
      "throw new Error('A compile check must not execute the Flow')\nexport {}\n",
    )
    await checkExampleProject(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source smoke rejects broken declaration evaluation', async () => {
  const root = await fixture()
  try {
    await writeFile(join(root, 'bindings/echo.ts'), "throw new Error('broken declaration')\n")
    await assert.rejects(checkExampleProject(root), /broken declaration/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source smoke rejects an unresolved Flow dependency', async () => {
  const root = await fixture()
  try {
    await writeFile(
      join(root, 'flows/echo/FLOW.ts'),
      "import {message} from './missing.js'\nexport {message}\n",
    )
    await assert.rejects(checkExampleProject(root), /Example package compilation failed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source smoke requires the default entrypoint', async () => {
  const root = await fixture()
  try {
    await writeFile(join(root, 'jig.ts'), 'export default {}\n')
    await assert.rejects(checkExampleProject(root), /default entrypoint/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
