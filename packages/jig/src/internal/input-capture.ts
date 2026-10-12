import {
  capturePrivateBytes,
  type PrivateCapturedBytes,
  readPrivateCapturedBytes,
  requirePrivateCapturedBytes,
} from './captured-bytes.js'

/** Invocation-only authority: an output capture cannot substitute for an input. */
export type PrivateCapturedInput = PrivateCapturedBytes<'input'>
export function capturePrivateInput(bytes: Uint8Array): PrivateCapturedInput {
  return capturePrivateBytes(bytes, 'input')
}
export function requirePrivateCapturedInput(value: PrivateCapturedInput) {
  return requirePrivateCapturedBytes(value, 'input')
}
export function readPrivateCapturedInput(value: PrivateCapturedInput): Buffer {
  return readPrivateCapturedBytes(value, 'input')
}
