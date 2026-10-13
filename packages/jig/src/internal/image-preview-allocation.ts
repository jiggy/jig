import { PRIVATE_PREVIEW_LIMITS } from './image-preview-policy.js'

/** Install only in a disposable renderer thread before resvg's audited glue.
 * Charge external copies before allocation, cumulatively for the entire job;
 * errors and garbage collection cannot replenish either allowance. */
export function privateGuardImageAllocations(): { copies(): number; decodedText(): number } {
  const OriginalArray = globalThis.Uint8Array
  const OriginalDecoder = globalThis.TextDecoder
  let copiedBytes = 0
  let decodedBytes = 0
  globalThis.Uint8Array = new Proxy(OriginalArray, {
    construct(target, args, newTarget) {
      const input: unknown = args[0]
      const view =
        input instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && input instanceof SharedArrayBuffer)
      if (!view) {
        const length =
          typeof input === 'number'
            ? input
            : input === undefined
              ? 0
              : Number((input as { length?: number }).length)
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > PRIVATE_PREVIEW_LIMITS.pngBytes ||
          copiedBytes + length > PRIVATE_PREVIEW_LIMITS.copyBytes
        )
          throw new Error('image allocation limit')
        copiedBytes += length
      }
      return Reflect.construct(target, args, newTarget)
    },
  })
  globalThis.TextDecoder = class extends OriginalDecoder {
    override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
      const charge = 2 * (input?.byteLength ?? 0)
      if (decodedBytes + charge > PRIVATE_PREVIEW_LIMITS.decodedTextBytes)
        throw new Error('image text limit')
      decodedBytes += charge
      return super.decode(input, options)
    }
  }
  return { copies: () => copiedBytes, decodedText: () => decodedBytes }
}
