import { expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckError } from '../src/diagnostics.js'
import { type CapturedPackage, capturePackageDirectory } from '../src/package/capture.js'

const metadata = '---\nname: x\ndescription: x\n---\n'
async function withDirectory(action: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), 'jig-package-test-'))
  try {
    await action(path)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
}
async function withCapture(
  source: string,
  action: (captured: CapturedPackage) => Promise<void>,
): Promise<void> {
  const captured = await capturePackageDirectory(source)
  try {
    await action(captured)
  } finally {
    await captured.dispose()
  }
}
async function expectCaptureError(source: string, code: string): Promise<void> {
  try {
    const captured = await capturePackageDirectory(source)
    await captured.dispose()
    throw new Error('expected CheckError')
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError)
    expect((error as CheckError).code).toBe(code)
  }
}

export { expectCaptureError, metadata, withCapture, withDirectory }
