import {
  capturePrivateBytes,
  capturePrivateByteStream,
  type PrivateCapturedBytes,
  readPrivateCapturedBytes,
  requirePrivateCapturedBytes,
} from './captured-bytes.js'
import { requirePrivateCapturedOutput, type PrivateCapturedOutput, type PrivateOutputFile } from './captured-output.js'
import { privateDescriptorByteChunks } from './descriptor-byte-stream.js'
import { createHash } from 'node:crypto'

/** Invocation-only authority: an output capture cannot substitute for an input. */
export type PrivateCapturedInput = PrivateCapturedBytes<'input'> | PrivateCapturedBytes<'artifact-input'>
export function capturePrivateInput(bytes: Uint8Array): PrivateCapturedInput {
  return capturePrivateBytes(bytes, 'input')
}
export function requirePrivateCapturedInput(value: PrivateCapturedInput) {
  return value?.purpose === 'artifact-input'
    ? requirePrivateCapturedBytes(value, 'artifact-input')
    : requirePrivateCapturedBytes(value as PrivateCapturedBytes<'input'>, 'input')
}
export function readPrivateCapturedInput(value: PrivateCapturedInput): Buffer {
  return value?.purpose === 'artifact-input'
    ? readPrivateCapturedBytes(value, 'artifact-input')
    : readPrivateCapturedBytes(value as PrivateCapturedBytes<'input'>, 'input')
}

/** Only original manifest members of a live held snapshot can become input authority. */
export function capturePrivateArtifactInput(
  snapshot: PrivateCapturedOutput,
  file: PrivateOutputFile,
  signal?: AbortSignal,
): PrivateCapturedInput {
  const held = requirePrivateCapturedOutput(snapshot)
  if (!held.files.includes(file))
    throw new TypeError('artifact input requires its original snapshot manifest member')
  function* chunks() {
    const hash = createHash('sha256')
    for (const bytes of privateDescriptorByteChunks(held.fd, file.bytes, file.offset)) {
      signal?.throwIfAborted()
      hash.update(bytes)
      yield bytes
    }
    if (`sha256:${hash.digest('hex')}` !== file.digest)
      throw new Error('artifact snapshot file identity changed')
    requirePrivateCapturedOutput(snapshot)
  }
  return capturePrivateByteStream(chunks(), 'artifact-input')
}
