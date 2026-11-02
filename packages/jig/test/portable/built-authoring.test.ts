import { expect, test } from 'bun:test'

test('built public and evaluator bundles expose working authoring functions', async () => {
  const publicSdk = await import('../../dist/index.js')
  const evaluatorSdk = await import('../../libexec/evaluator/project-evaluator-sdk.bundle.js')

  for (const sdk of [publicSdk, evaluatorSdk]) {
    expect(typeof sdk.defineJig).toBe('function')
    expect(typeof sdk.defineBinding).toBe('function')
    expect(typeof sdk.discover).toBe('function')
    expect(sdk.defineJig({ flows: ['flows/example'] })).toEqual({
      flows: { kind: 'members', paths: ['flows/example'] },
    })
    expect(sdk.discover('flows')).toEqual({ kind: 'discover', roots: ['flows'] })
    expect(sdk.defineBinding({ package: 'flows/example' })).toEqual({
      kind: 'package',
      package: 'flows/example',
      settings: {},
      slots: {},
    })
  }
})
