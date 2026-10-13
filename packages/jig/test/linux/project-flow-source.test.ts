import { describe, test } from 'bun:test'
import { discover } from '../../src/project/author.js'
import { captureFlowSource } from '../../src/project/flow-source.js'
import {
  expectCode,
  metadata,
  packageFiles,
  withProject,
} from '.././project-flow-source.fixture.js'

describe('private project Flow source capture', () => {
  test('rejects discovered case-fold collisions on a case-sensitive filesystem', async () => {
    await withProject(async (root) => {
      await packageFiles(root, 'flows/a', { 'FLOW.md': metadata('a') })
      await packageFiles(root, 'flows/A', { 'FLOW.md': metadata('other') })
      await expectCode(() => captureFlowSource(root, discover('flows')), 'PROJECT_SOURCE_COLLISION')
    })
  })
})

if (process.platform !== 'linux') throw Error('This suite requires Linux')
