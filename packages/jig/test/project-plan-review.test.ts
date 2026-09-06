import { describe, expect, test } from 'bun:test'

import type { PrivateActivationReviewPlan } from '../src/internal/activation-admission-store.js'
import { renderPrivateProjectPlanReview } from '../src/internal/project-plan-review.js'

describe('private project Plan review', () => {
  test('renders complete portable policy while omitting private host identities', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const plan = {
      operation: 'admission',
      baseGeneration: null,
      lockMode: 'update',
      observedLock: { state: 'absent' },
      proposed: {
        lockDigest: digest,
        lock: {
          packages: {
            'flows/review': {
              digest,
              directRun: false,
              uses: {
                agent: {
                  id: 'https://jig.md/contracts/agent-run',
                  version: '1.0.0',
                  digest: 'sha256:5a0f06495323419d275eeff92617d9287647ece137dacc9c5c6d50466d65c0f0',
                },
              },
            },
          },
          bindings: {
            review: {
              packagePath: 'flows/review',
              settings: {},
              slots: {},
            },
          },
        },
        targets: [
          {
            request: {
              target: { kind: 'binding', id: 'review' },
              mode: 'run',
              packagePath: 'flows/review',
              package: { digest },
              entrypoint: { path: 'flow.ts', suffix: 'ts' },
              settings: {
                style: 'focused',
                hidden: '\u202e\u200bline\n\t\u0000é😀',
                '\u202ekey': 'value',
              },
              flowSlots: {},
              attachments: {},
              digest: `sha256:${'b'.repeat(64)}`,
            },
            disposition: {
              state: 'ready',
              recipeDigest: 'private-recipe-sentinel',
              observationDigest: 'private-observation-sentinel',
            },
          },
        ],
      },
    } as unknown as PrivateActivationReviewPlan['plan']
    const rendered = renderPrivateProjectPlanReview({
      plan,
      baseCandidate: null,
    } as PrivateActivationReviewPlan)

    expect(rendered.mediaType).toBe('text/plain; charset=utf-8')
    expect(rendered.text).toContain('"packagePath": "flows/review"')
    expect(rendered.text).toContain('"settings": {')
    expect(rendered.text).toContain('"style": "focused"')
    expect(rendered.text).toContain(
      '"hidden": "\\u202e\\u200bline\\n\\t\\u0000\\u00e9\\ud83d\\ude00"',
    )
    expect(rendered.text).toContain('"\\u202ekey": "value"')
    expect(rendered.text).not.toContain('\u202e')
    expect(rendered.text).not.toContain('\u200b')
    expect(rendered.text).not.toContain('é')
    expect(
      [...rendered.text].every((value) => {
        const code = value.codePointAt(0)!
        return code === 0x0a || (code >= 0x20 && code <= 0x7e)
      }),
    ).toBe(true)
    expect(rendered.text).toContain('"state": "ready"')
    expect(rendered.text).not.toContain('private-recipe-sentinel')
    expect(rendered.text).not.toContain('private-observation-sentinel')
    expect(rendered.text).not.toContain('recipeDigest')
    expect(rendered.text).not.toContain('observationDigest')
    expect(rendered.text).toContain('"attachments": {}')
    expect(rendered.text).toContain(`"digest": "${digest}"`)
    expect(rendered.text).toContain('"id": "https://jig.md/contracts/agent-run"')
    expect(rendered.text).not.toContain('"operation"')
    expect(rendered.text).not.toContain('lockMode')
    expect(Object.isFrozen(rendered)).toBe(true)
  })

  test('does not expose admission operation or generation state', () => {
    const admission = reviewPlan('admission', `sha256:${'b'.repeat(64)}`)
    const repair = reviewPlan('lock-repair', `sha256:${'b'.repeat(64)}`)

    const admissionText = renderPrivateProjectPlanReview({
      plan: admission,
      baseCandidate: null,
    } as PrivateActivationReviewPlan).text
    const repairText = renderPrivateProjectPlanReview({
      plan: repair,
      baseCandidate: null,
    } as PrivateActivationReviewPlan).text
    expect(admissionText).toBe(repairText)
    expect(admissionText).not.toContain('admission')
    expect(admissionText).not.toContain('lock-repair')
    expect(admissionText).not.toContain('generation')
  })

  test('shows current and proposed state with explicit additions, removals, and changes', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const plan = reviewPlan('admission', `sha256:${'b'.repeat(64)}`)
    const current = {
      lock: {
        packages: { 'flows/old': { digest, directRun: false, uses: {} } },
        bindings: { review: { packagePath: 'flows/old', settings: {}, slots: {} } },
      },
      candidate: {
        targets: [
          {
            request: {
              target: { kind: 'binding', id: 'review' },
              mode: 'run',
              packagePath: 'flows/old',
              package: { digest },
              entrypoint: { path: 'flow.ts', suffix: 'ts' },
              settings: {},
              flowSlots: {},
              attachments: {},
            },
            disposition: { state: 'ready' },
          },
        ],
      },
    }
    const proposed = {
      ...plan,
      proposed: {
        ...plan.proposed,
        lock: {
          packages: { 'flows/new': { digest, directRun: false, uses: {} } },
          bindings: { review: { packagePath: 'flows/new', settings: {}, slots: {} } },
        },
        targets: [
          {
            request: {
              target: { kind: 'binding', id: 'review' },
              mode: 'run',
              packagePath: 'flows/new',
              package: { digest },
              entrypoint: { path: 'flow.ts', suffix: 'ts' },
              settings: {},
              flowSlots: {},
              attachments: {},
            },
            disposition: { state: 'unavailable', code: 'RUNTIME_UNAVAILABLE' },
          },
        ],
      },
    }
    const text = renderPrivateProjectPlanReview({
      plan: proposed,
      baseCandidate: current,
    } as unknown as PrivateActivationReviewPlan).text

    expect(text).toContain('"current": {')
    expect(text).toContain('"proposed": {')
    const value = JSON.parse(text.slice(text.indexOf('{')))
    expect(value.changes.packages).toEqual({
      added: ['flows/new'],
      changed: [],
      removed: ['flows/old'],
    })
    expect(value.changes.targets.changed).toEqual(['binding:review'])
  })

  test('shows exact package identity changes and their affected target', () => {
    const oldDigest = `sha256:${'a'.repeat(64)}`
    const newDigest = `sha256:${'b'.repeat(64)}`
    const plan = reviewPlan('admission', newDigest)
    const target = (digest: string) => ({
      request: {
        target: { kind: 'flow' as const, path: 'flows/review' },
        mode: 'run' as const,
        packagePath: 'flows/review',
        package: { digest },
        entrypoint: { path: 'flow.ts', suffix: 'ts' },
        settings: {},
        flowSlots: {},
        attachments: {},
      },
      disposition: { state: 'ready' as const },
    })
    const current = {
      lock: {
        packages: { 'flows/review': { digest: oldDigest, directRun: true, uses: {} } },
        bindings: {},
      },
      candidate: { targets: [target(oldDigest)] },
    }
    const proposed = {
      ...plan,
      proposed: {
        ...plan.proposed,
        lock: {
          packages: { 'flows/review': { digest: newDigest, directRun: true, uses: {} } },
          bindings: {},
        },
        targets: [target(newDigest)],
      },
    }

    const text = renderPrivateProjectPlanReview({
      plan: proposed,
      baseCandidate: current,
    } as unknown as PrivateActivationReviewPlan).text
    const value = JSON.parse(text.slice(text.indexOf('{')))

    expect(value.current.portablePolicy.packages['flows/review'].digest).toBe(oldDigest)
    expect(value.proposed.portablePolicy.packages['flows/review'].digest).toBe(newDigest)
    expect(value.changes.packages.changed).toEqual(['flows/review'])
    expect(value.changes.targets.changed).toEqual(['flow:flows/review'])
  })

  test('shows slot changes and child package identity effects without embedding child digests', () => {
    const parentDigest = `sha256:${'a'.repeat(64)}`
    const oldChildDigest = `sha256:${'b'.repeat(64)}`
    const newChildDigest = `sha256:${'c'.repeat(64)}`
    const bindingTarget = (slotPath: string) => ({
      request: {
        target: { kind: 'binding' as const, id: 'router' },
        mode: 'run' as const,
        packagePath: 'flows/router',
        package: { digest: parentDigest },
        entrypoint: { path: 'flow.ts', suffix: 'ts' },
        settings: {},
        flowSlots: { work: { kind: 'flow', path: slotPath } },
        attachments: {},
      },
      disposition: { state: 'ready' as const },
    })
    const childTarget = (
      path: string,
      digest: string,
      state: 'ready' | 'unavailable' = 'ready',
    ) => ({
      request: {
        target: { kind: 'flow' as const, path },
        mode: 'run' as const,
        packagePath: path,
        package: { digest },
        entrypoint: { path: 'flow.ts', suffix: 'ts' },
        settings: {},
        flowSlots: {},
        attachments: {},
      },
      disposition:
        state === 'ready'
          ? { state: 'ready' as const, recipeDigest: `sha256:${'1'.repeat(64)}` }
          : { state: 'unavailable' as const, code: 'RUNTIME_UNAVAILABLE' },
    })
    const candidate = (
      childDigest: string,
      slotPath: string,
      childState: 'ready' | 'unavailable' = 'ready',
    ) => ({
      lock: {
        packages: {
          'flows/bug': { digest: childDigest, directRun: true, uses: {} },
          'flows/question': { digest: oldChildDigest, directRun: true, uses: {} },
          'flows/router': { digest: parentDigest, directRun: true, uses: {} },
        },
        bindings: {
          router: {
            packagePath: 'flows/router',
            settings: {},
            slots: { work: { kind: 'flow', path: slotPath } },
          },
        },
      },
      candidate: {
        targets: [
          childTarget('flows/bug', childDigest, childState),
          childTarget('flows/question', oldChildDigest),
          bindingTarget(slotPath),
        ],
      },
    })

    const current = candidate(oldChildDigest, 'flows/bug')
    const retargeted = candidate(oldChildDigest, 'flows/question')
    const slotChangePlan = {
      ...reviewPlan('admission', `sha256:${'d'.repeat(64)}`),
      proposed: {
        lockDigest: `sha256:${'e'.repeat(64)}`,
        lock: retargeted.lock,
        targets: retargeted.candidate.targets,
      },
    }
    const slotReview = JSON.parse(
      renderPrivateProjectPlanReview({
        plan: slotChangePlan,
        baseCandidate: current,
      } as unknown as PrivateActivationReviewPlan)
        .text.split('\n\n')
        .at(-1)!,
    )
    expect(slotReview.changes.bindings.changed).toEqual(['router'])
    expect(slotReview.changes.targets.changed).toEqual(['binding:router'])

    const digestChangePlan = {
      ...reviewPlan('admission', `sha256:${'f'.repeat(64)}`),
      proposed: {
        lockDigest: `sha256:${'0'.repeat(64)}`,
        lock: candidate(newChildDigest, 'flows/bug').lock,
        targets: candidate(newChildDigest, 'flows/bug').candidate.targets,
      },
    }
    const digestReview = JSON.parse(
      renderPrivateProjectPlanReview({
        plan: digestChangePlan,
        baseCandidate: current,
      } as unknown as PrivateActivationReviewPlan)
        .text.split('\n\n')
        .at(-1)!,
    )
    expect(digestReview.changes.packages.changed).toEqual(['flows/bug'])
    expect(digestReview.changes.bindings.changed).toEqual([])
    expect(digestReview.changes.targets.changed).toEqual(['binding:router', 'flow:flows/bug'])
    expect(digestReview.proposed.portablePolicy.bindings.router).toEqual({
      packagePath: 'flows/router',
      settings: {},
      slots: { work: { kind: 'flow', path: 'flows/bug' } },
    })
    expect(JSON.stringify(digestReview.proposed.portablePolicy.bindings.router)).not.toContain(
      newChildDigest,
    )

    const unavailable = candidate(oldChildDigest, 'flows/bug', 'unavailable')
    const availabilityPlan = {
      ...reviewPlan('admission', `sha256:${'2'.repeat(64)}`),
      proposed: {
        lockDigest: `sha256:${'3'.repeat(64)}`,
        lock: unavailable.lock,
        targets: unavailable.candidate.targets,
      },
    }
    const availabilityReview = JSON.parse(
      renderPrivateProjectPlanReview({
        plan: availabilityPlan,
        baseCandidate: current,
      } as unknown as PrivateActivationReviewPlan)
        .text.split('\n\n')
        .at(-1)!,
    )
    expect(availabilityReview.changes.targets.changed).toEqual(['binding:router', 'flow:flows/bug'])
  })

  test("marks a parent affected by its selected Binding's settings and availability", () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const candidate = (style: string, ready: boolean) => {
      const bindings = {
        router: {
          packagePath: 'flows/router',
          settings: {},
          slots: { review: { kind: 'binding', id: 'reviewer' } },
        },
        reviewer: { packagePath: 'flows/reviewer', settings: { style }, slots: {} },
      }
      return {
        lock: {
          packages: {
            'flows/router': { digest, directRun: true, uses: {} },
            'flows/reviewer': { digest, directRun: false, uses: {} },
          },
          bindings,
        },
        candidate: {
          targets: Object.entries(bindings).map(([id, binding]) => ({
            request: {
              target: { kind: 'binding', id },
              mode: 'run',
              packagePath: binding.packagePath,
              package: { digest },
              entrypoint: { path: 'flow.ts', suffix: 'ts' },
              settings: binding.settings,
              flowSlots: binding.slots,
              attachments: {},
            },
            disposition:
              id === 'reviewer' && !ready
                ? { state: 'unavailable', code: 'RUNTIME_UNAVAILABLE' }
                : { state: 'ready' },
          })),
        },
      }
    }
    const current = candidate('brief', true)
    for (const proposed of [candidate('critical', true), candidate('brief', false)]) {
      const plan = {
        ...reviewPlan('admission', digest),
        proposed: { lock: proposed.lock, targets: proposed.candidate.targets },
      }
      const review = JSON.parse(
        renderPrivateProjectPlanReview({
          plan,
          baseCandidate: current,
        } as unknown as PrivateActivationReviewPlan)
          .text.split('\n\n')
          .at(-1)!,
      )
      expect(review.changes.targets.changed).toEqual(['binding:reviewer', 'binding:router'])
      expect(review.proposed.portablePolicy.bindings.router.slots.review).toEqual({
        kind: 'binding',
        id: 'reviewer',
      })
    }
  })

  test('fails before allocating a review larger than its public envelope', () => {
    const plan = reviewPlan('admission', `sha256:${'b'.repeat(64)}`)
    expect(() =>
      renderPrivateProjectPlanReview(
        { plan, baseCandidate: null } as PrivateActivationReviewPlan,
        64,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'UNAVAILABLE',
        message: 'project plan review exceeds the supported display size',
      }),
    )
  })
})

function reviewPlan(
  operation: 'admission' | 'lock-repair',
  baseGeneration: string,
): PrivateActivationReviewPlan['plan'] {
  const digest = `sha256:${'a'.repeat(64)}`
  return {
    operation,
    baseGeneration,
    lockMode: 'update',
    observedLock: { state: 'absent' },
    proposed: {
      lockDigest: digest,
      lock: { packages: {}, bindings: {} },
      targets: [],
    },
  } as unknown as PrivateActivationReviewPlan['plan']
}
