import { expect } from 'bun:test'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
function killGuardian(identity: { guardianPid: number; guardianVersion: number }) {
  const ffi = createRequire(import.meta.url)('bun:ffi')
  const api = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
    proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
  })
  try {
    const token = Buffer.alloc(32)
    token.writeUInt32LE(identity.guardianPid, 20)
    token.writeUInt32LE(identity.guardianVersion, 28)
    expect(api.symbols.proc_signal_with_audittoken(ffi.ptr(token), 9)).toBe(0)
  } finally {
    api.close()
  }
}

export { exists, killGuardian }
