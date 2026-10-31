import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { privateJigDevelopmentCheckout } from '../../src/development-checkout.js'
import {
  privateExactJigVersion,
  privateJigVersion,
  privateJigVersionRecovery,
} from '../../src/installation-version.js'
import { captureProjectJigRequirement } from '../../src/project/jig-version.js'
import { openPrivateProjectRoot } from '../../src/project/root.js'

test('host requirements accept exact SemVer and reject ranges, tags and hostile text', () => {
  for (const version of ['0.0.0', '1.2.3', '0.1.0-alpha.43', '1.0.0-rc.1+build.4'])
    expect(privateExactJigVersion(version)).toBeTrue()
  for (const version of [
    '01.0.0',
    '1.0.0-01',
    '1.0.0\n',
    'latest',
    '*',
    '^1.0.0',
    '>=1.0.0',
    'workspace:*',
    '1.0.0;echo PRIVATE',
    '',
    null,
    {},
    '1.0.0+' + 'x'.repeat(128),
  ])
    expect(privateExactJigVersion(version)).toBeFalse()
})

test('contributor recovery is determined by this installation instead of project cwd', async () => {
  const release = resolve(import.meta.dir, '../..')
  expect(await privateJigDevelopmentCheckout(release)).toBe(resolve(release, '../..'))
  expect(await privateJigVersionRecovery(privateJigVersion)).toContain(
    'From the repository root, run just jig::build',
  )
  const directory = await mkdtemp(join(tmpdir(), 'jig-ordinary-install-'))
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@jigging/jig' }))
    expect(await privateJigDevelopmentCheckout(directory)).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('compatibility metadata is optional, captured without evaluation, and rechecked after edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-version-metadata-'))
  const root = await openPrivateProjectRoot(directory)
  try {
    const absent = await captureProjectJigRequirement(root)
    await absent.verify()
    const manifest = join(directory, 'package.json')
    await writeFile(
      manifest,
      JSON.stringify({
        engines: { jig: privateJigVersion },
      }),
    )
    await expect(absent.verify()).rejects.toMatchObject({ code: 'PROJECT_SOURCE_CHANGED' })
    const matching = await captureProjectJigRequirement(root)
    await matching.verify()
    await writeFile(manifest, JSON.stringify({ engines: { jig: '999.0.0' } }))
    await expect(matching.verify()).rejects.toMatchObject({ code: 'PROJECT_SOURCE_CHANGED' })
    await expect(captureProjectJigRequirement(root)).rejects.toMatchObject({
      code: 'PROJECT_JIG_VERSION_MISMATCH',
      pointer: '/engines/jig',
    })
    expect(await readFile(manifest, 'utf8')).toContain('999.0.0')
    await writeFile(manifest, '{"engines":{"jig":"PRIVATE_OWN_VALUE"}}')
    await expect(captureProjectJigRequirement(root)).rejects.toMatchObject({
      code: 'PROJECT_JIG_REQUIREMENT_INVALID',
      pointer: '/engines/jig',
    })
    await writeFile(manifest, JSON.stringify({ engines: { node: '>=22' } }))
    await (await captureProjectJigRequirement(root)).verify()
    for (const engines of [null, [], 'PRIVATE_OWN_VALUE']) {
      await writeFile(manifest, JSON.stringify({ engines }))
      await expect(captureProjectJigRequirement(root)).rejects.toMatchObject({
        code: 'PROJECT_JIG_REQUIREMENT_INVALID',
      })
    }
  } finally {
    await root.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
