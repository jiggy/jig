/** Command-owned diagnostic evidence; never application results or execution authority. */
export class PrivateRunDiagnostics {
  private readonly entries = new Map<
    string,
    {
      operations: readonly string[]
      decoder: TextDecoder
      retained: Uint8Array[]
      stderrBytes: number
      stderrTruncated: boolean
    }
  >()
  private remaining = 64 * 1024
  private truncated = false

  record(bytes: Uint8Array, operations: readonly string[] = []): string {
    const key = JSON.stringify(operations)
    let entry = this.entries.get(key)
    if (entry === undefined) {
      if (this.entries.size === 32) {
        this.truncated = true
        return ''
      }
      entry = {
        operations: [...operations],
        decoder: new TextDecoder(),
        retained: [],
        stderrBytes: 0,
        stderrTruncated: false,
      }
      this.entries.set(key, entry)
    }
    entry.stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, entry.stderrBytes + bytes.byteLength)
    const kept = bytes.slice(0, this.remaining)
    this.remaining -= kept.byteLength
    if (kept.byteLength) entry.retained.push(kept)
    if (kept.byteLength !== bytes.byteLength) entry.stderrTruncated = this.truncated = true
    return entry.decoder.decode(bytes, { stream: true })
  }

  snapshot() {
    return {
      entries: [...this.entries.values()].map(
        ({ operations, retained, stderrBytes, stderrTruncated }) => ({
          operations: [...operations],
          stderr: new TextDecoder().decode(Buffer.concat(retained)),
          stderrBytes,
          stderrTruncated,
        }),
      ),
      truncated: this.truncated,
    }
  }
}
