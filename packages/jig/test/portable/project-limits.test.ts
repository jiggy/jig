import { expect, test } from 'bun:test'
import {
  capturePrivateDependencyPreparationLimitEnvironment,
  resolvePrivateDependencyPreparationLimits,
} from '../../src/internal/dependency-preparation-limits.js'
import { privatePackageArtifactArchiveBytes } from '../../src/internal/package-artifact-store.js'
import {
  maximumPackageArtifactBytes,
  PACKAGE_1_MAX_PATH_BYTES,
  PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS,
} from '../../src/package/capacity.js'
import {
  DEFAULT_PROJECT_DEPENDENCY_LIMITS,
  DEPENDENCY_PREPARATION_LIMIT_POLICY,
  normalizeDependencyPreparationOutputLimits,
  normalizeJigLimits,
  normalizeProjectDependencyLimits,
} from '../../src/project/limits.js'

test('project dependency choices are inert, closed and distinct from defaults', () => {
  const input = { dependencies: { maxPreparedBytes: 64 * 1024 * 1024, maxPreparations: 32 } }
  const normalized = normalizeJigLimits(input)
  input.dependencies.maxPreparedBytes = 1
  input.dependencies.maxPreparations = 1
  expect(normalized).toEqual({
    dependencies: { maxPreparedBytes: 64 * 1024 * 1024, maxPreparations: 32 },
  })
  expect(Object.isFrozen(normalized)).toBe(true)
  expect(Object.isFrozen(normalized.dependencies)).toBe(true)
  expect(normalizeJigLimits({})).toEqual({})
  expect(normalizeJigLimits({ dependencies: {} })).toEqual({ dependencies: {} })

  for (const value of [
    null,
    [],
    { unknown: {} },
    { dependencies: undefined },
    { dependencies: null },
    { dependencies: { maxPreparedFiles: undefined } },
    { dependencies: { maxPreparations: undefined } },
    { dependencies: { maxFiles: 8192 } },
  ])
    expect(() => normalizeJigLimits(value)).toThrow()

  let evaluated = false
  expect(() =>
    normalizeJigLimits({
      get dependencies() {
        evaluated = true
        return {}
      },
    }),
  ).toThrow()
  expect(evaluated).toBe(false)
})

test('preparation boundaries require complete supported positive integer budgets', () => {
  expect(normalizeProjectDependencyLimits(DEFAULT_PROJECT_DEPENDENCY_LIMITS)).toEqual({
    maxPreparedBytes: 33_554_432,
    maxPreparedFiles: 4096,
    maxPreparations: 16,
  })
  expect(
    normalizeProjectDependencyLimits({
      maxPreparedBytes: 1,
      maxPreparedFiles: 1,
      maxPreparations: 1,
    }),
  ).toEqual({
    maxPreparedBytes: 1,
    maxPreparedFiles: 1,
    maxPreparations: 1,
  })
  expect(
    normalizeProjectDependencyLimits({
      ...DEFAULT_PROJECT_DEPENDENCY_LIMITS,
      maxPreparations: 256,
    }).maxPreparations,
  ).toBe(256)
  for (const field of ['maxPreparedBytes', 'maxPreparedFiles', 'maxPreparations'] as const) {
    const maximum = DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum[field]
    for (const value of [0, -1, 1.5, maximum + 1, NaN, Infinity, '8192', null])
      expect(() =>
        normalizeProjectDependencyLimits({
          ...DEFAULT_PROJECT_DEPENDENCY_LIMITS,
          [field]: value,
        }),
      ).toThrow()
  }
  expect(() => normalizeProjectDependencyLimits({ maxPreparedFiles: 4096 })).toThrow()
  expect(() =>
    normalizeProjectDependencyLimits({ maxPreparedBytes: 33_554_432, maxPreparedFiles: 4096 }),
  ).toThrow('maxPreparations')
  expect(() =>
    normalizeProjectDependencyLimits({
      ...DEFAULT_PROJECT_DEPENDENCY_LIMITS,
      timeoutMs: 1,
    }),
  ).toThrow()
})

test('supported combinations fit canonical artifacts including maximum-length paths', () => {
  const path = ['a'.repeat(255), 'b'.repeat(255), 'c'.repeat(255), 'd'.repeat(254), 'e'].join('/')
  expect(Buffer.byteLength(path)).toBe(PACKAGE_1_MAX_PATH_BYTES)
  expect(maximumPackageArtifactBytes(100, 1)).toBe(
    privatePackageArtifactArchiveBytes([{ path, size: 100 }]),
  )
  const maxPreparedBytes = DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum.maxPreparedBytes
  const emptyBytes = privatePackageArtifactArchiveBytes([])
  const recordBytes = privatePackageArtifactArchiveBytes([{ path, size: 0 }]) - emptyBytes
  const lastSupported = Math.floor(
    (PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes - emptyBytes - maxPreparedBytes) /
      recordBytes,
  )
  expect(
    normalizeProjectDependencyLimits({
      ...DEFAULT_PROJECT_DEPENDENCY_LIMITS,
      maxPreparedBytes,
      maxPreparedFiles: lastSupported,
    }),
  ).toEqual({
    ...DEFAULT_PROJECT_DEPENDENCY_LIMITS,
    maxPreparedBytes,
    maxPreparedFiles: lastSupported,
  })
  expect(() =>
    normalizeProjectDependencyLimits({
      ...DEFAULT_PROJECT_DEPENDENCY_LIMITS,
      maxPreparedBytes,
      maxPreparedFiles: lastSupported + 1,
    }),
  ).toThrow('canonical artifact capacity')
  expect(
    normalizeProjectDependencyLimits({
      ...DEFAULT_PROJECT_DEPENDENCY_LIMITS,
      maxPreparedBytes: 1,
      maxPreparedFiles: DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum.maxPreparedFiles,
    }).maxPreparedFiles,
  ).toBe(65_536)
})

test('workers accept only the output budgets and cannot receive a preparation count', () => {
  const output = { maxPreparedBytes: 33_554_432, maxPreparedFiles: 4096 }
  expect(normalizeDependencyPreparationOutputLimits(output)).toEqual(output)
  expect(() =>
    normalizeDependencyPreparationOutputLimits({ ...output, maxPreparations: 32 }),
  ).toThrow('maxPreparations')
})

test('operator overrides resolve per field and preserve their snapshotted origin', () => {
  expect(resolvePrivateDependencyPreparationLimits()).toEqual({
    limits: DEFAULT_PROJECT_DEPENDENCY_LIMITS,
    outputLimits: { maxPreparedBytes: 33_554_432, maxPreparedFiles: 4096 },
    origins: {
      maxPreparedBytes: 'default',
      maxPreparedFiles: 'default',
      maxPreparations: 'default',
    },
  })
  expect(
    resolvePrivateDependencyPreparationLimits({ dependencies: { maxPreparations: 32 } }),
  ).toEqual({
    limits: { ...DEFAULT_PROJECT_DEPENDENCY_LIMITS, maxPreparations: 32 },
    outputLimits: { maxPreparedBytes: 33_554_432, maxPreparedFiles: 4096 },
    origins: {
      maxPreparedBytes: 'default',
      maxPreparedFiles: 'default',
      maxPreparations: 'project',
    },
  })
  const names = DEPENDENCY_PREPARATION_LIMIT_POLICY.environment
  const raw = { [names.maxPreparedBytes]: '67108864', [names.maxPreparations]: '64' }
  const environment = capturePrivateDependencyPreparationLimitEnvironment(raw)
  raw[names.maxPreparedBytes] = '1'
  raw[names.maxPreparations] = '1'
  const resolved = resolvePrivateDependencyPreparationLimits(
    { dependencies: { maxPreparedBytes: 1, maxPreparedFiles: 8192, maxPreparations: 32 } },
    environment,
  )
  expect(resolved).toEqual({
    limits: { maxPreparedBytes: 64 * 1024 * 1024, maxPreparedFiles: 8192, maxPreparations: 64 },
    outputLimits: { maxPreparedBytes: 64 * 1024 * 1024, maxPreparedFiles: 8192 },
    origins: {
      maxPreparedBytes: 'environment',
      maxPreparedFiles: 'project',
      maxPreparations: 'environment',
    },
  })
  expect(Object.isFrozen(environment)).toBe(true)
  expect(Object.isFrozen(resolved.limits)).toBe(true)
  expect(Object.isFrozen(resolved.outputLimits)).toBe(true)
  expect(Object.isFrozen(resolved.origins)).toBe(true)
  expect(() =>
    resolvePrivateDependencyPreparationLimits(
      { dependencies: { maxPreparedBytes: 128 * 1024 * 1024 } },
      capturePrivateDependencyPreparationLimitEnvironment({ [names.maxPreparedFiles]: '65536' }),
    ),
  ).toThrow('canonical artifact capacity')
})

test('invalid operator values fail with the setting name without copying their contents', () => {
  for (const field of ['maxPreparedBytes', 'maxPreparedFiles', 'maxPreparations'] as const) {
    const name = DEPENDENCY_PREPARATION_LIMIT_POLICY.environment[field]
    for (const text of [
      '',
      '0',
      '-1',
      '+1',
      '01',
      '1.0',
      '1e3',
      ' 4096',
      '4096\n',
      String(DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum[field] + 1),
      'secret-value',
    ]) {
      let error: unknown
      try {
        capturePrivateDependencyPreparationLimitEnvironment({ [name]: text })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(TypeError)
      expect((error as Error).message).toContain(name)
      if (text === 'secret-value') expect((error as Error).message).not.toContain(text)
    }
  }
})

test('private operator boundaries reject accessors and Proxies without running their code', () => {
  let reflected = false
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        reflected = true
        return []
      },
      getOwnPropertyDescriptor() {
        reflected = true
        return undefined
      },
    },
  )
  expect(() => capturePrivateDependencyPreparationLimitEnvironment(proxy)).toThrow()
  expect(() => resolvePrivateDependencyPreparationLimits(undefined, proxy)).toThrow()
  expect(() => resolvePrivateDependencyPreparationLimits(proxy)).toThrow()
  expect(() => resolvePrivateDependencyPreparationLimits({ dependencies: proxy })).toThrow()
  const name = DEPENDENCY_PREPARATION_LIMIT_POLICY.environment.maxPreparedBytes
  const accessors = Object.defineProperty({}, name, {
    enumerable: true,
    get() {
      reflected = true
      return '4096'
    },
  })
  expect(() => capturePrivateDependencyPreparationLimitEnvironment(accessors)).toThrow()
  expect(reflected).toBe(false)
})
