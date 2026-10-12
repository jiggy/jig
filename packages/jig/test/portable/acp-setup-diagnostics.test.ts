import { describe, expect, test } from 'bun:test'
import {
  ACP_SETUP_CAUSES,
  ACP_SETUP_HINTS,
  acpSetupHints,
} from '../../src/internal/acp-setup-diagnostics.js'

describe('native-client setup recovery', () => {
  for (const [suiteCaseIndex, suiteCaseValue] of (['linux', 'darwin'] as const).entries()) {
    test('%s installation advice matches that host' + ` (case ${suiteCaseIndex + 1})`, () =>
      Reflect.apply(
        (platform) => {
          const hints = acpSetupHints(platform)
          for (const client of ['CODEX', 'CLAUDE', 'PI']) {
            const hint = hints[`PROJECT_ACP_${client}_INSTALLATION`]
            expect(hint).toContain(platform === 'darwin' ? 'macOS' : 'Linux x86-64')
            expect(hint).not.toContain(platform === 'darwin' ? 'Linux' : 'macOS')
            if (platform === 'darwin') expect(hint).toContain("this Mac's architecture")
          }
          expect(hints.PROJECT_ACP_PI_INSTALLATION).toContain('Pi 0.84.4')
          expect(hints.PROJECT_ACP_PI_INSTALLATION).toContain('package.json and theme directory')
          expect(hints.PROJECT_ACP_PI_INSTALLATION).toContain(
            'a Node/npm launcher is not supported',
          )
          const helper = hints.PROJECT_ACP_CODEX_SANDBOX
          expect(helper).toContain(
            platform === 'darwin' ? '/usr/bin/sandbox-exec' : 'unprivileged Bubblewrap',
          )
          expect(helper).not.toContain(platform === 'darwin' ? 'Bubblewrap' : 'sandbox-exec')
          expect(helper).toContain('do not')
          expect(helper).toContain('bypass containment')
        },
        undefined,
        Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
      ),
    )
  }
  test('each closed stage retains its cause and a review-only next action on either host', () => {
    const linux = acpSetupHints('linux')
    const mac = acpSetupHints('darwin')
    expect(Object.keys(linux).sort()).toEqual(Object.keys(ACP_SETUP_CAUSES).sort())
    expect(Object.keys(mac).sort()).toEqual(Object.keys(linux).sort())
    for (const [code, hint] of Object.entries(mac)) {
      expect(hint).toContain('Then retry jig review. No Flow was started by this review.')
      if (!code.endsWith('_INSTALLATION') && !code.endsWith('_SANDBOX'))
        expect(hint).toBe(linux[code])
    }
    expect(ACP_SETUP_HINTS).toEqual(process.platform === 'darwin' ? mac : linux)
  })
})
