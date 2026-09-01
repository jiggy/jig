import { MAX_FRAME_BYTES } from "./json.js";

export interface Transport {
  readonly input: AsyncIterable<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
  stopReading(): Promise<void>;
}

export class FramingViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingViolation";
  }
}

interface ProcessStream {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
  pause?(): void;
  destroy?(): void;
}

interface ProcessOutput {
  write(
    bytes: Uint8Array,
    callback: (error?: Error | null) => void,
  ): boolean;
}

interface ProcessLike {
  stdin: ProcessStream;
  stdout: ProcessOutput;
}

interface DenoReader {
  readonly readable: ReadableStream<Uint8Array>;
}

interface DenoWriter {
  write(bytes: Uint8Array): Promise<number>;
}

interface DenoLike {
  stdin: DenoReader;
  stdout: DenoWriter;
}

export function stdioTransport(): Transport {
  const processLike = (globalThis as { process?: ProcessLike }).process;
  if (processLike?.stdin && processLike.stdout) {
    let stopped = false;
    return {
      input: {
        async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
          for await (const chunk of processLike.stdin) {
            if (stopped) return;
            yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          }
        },
      },
      write(bytes) {
        return new Promise<void>((resolve, reject) => {
          processLike.stdout.write(bytes, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
      async stopReading() {
        stopped = true;
        processLike.stdin.pause?.();
        processLike.stdin.destroy?.();
      },
    };
  }

  const deno = (globalThis as { Deno?: DenoLike }).Deno;
  if (deno?.stdin && deno.stdout) {
    const reader = deno.stdin.readable.getReader();
    return {
      input: {
        async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
          while (true) {
            const result = await reader.read();
            if (result.done) return;
            yield result.value;
          }
        },
      },
      async write(bytes) {
        let offset = 0;
        while (offset < bytes.byteLength) {
          const written = await deno.stdout.write(bytes.subarray(offset));
          if (written <= 0) throw new Error("stdout write made no progress");
          offset += written;
        }
      },
      async stopReading() {
        await reader.cancel();
      },
    };
  }

  throw new Error("@jigging/flow could not find protocol stdin and stdout");
}

export async function* readFrames(
  input: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(8_192);
  let length = 0;

  for await (const chunk of input) {
    let start = 0;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      const segment = chunk.subarray(start, index);
      const frameLength = length + segment.byteLength;
      if (frameLength > MAX_FRAME_BYTES) {
        throw new FramingViolation("frame exceeds FLOW JSON/1 byte limit");
      }
      ensureCapacity(frameLength);
      buffer.set(segment, length);
      const frame = buffer.slice(0, frameLength);
      length = 0;
      start = index + 1;
      yield frame;
    }

    if (start < chunk.byteLength) {
      const remainder = chunk.subarray(start);
      const nextLength = length + remainder.byteLength;
      if (nextLength > MAX_FRAME_BYTES) {
        throw new FramingViolation("frame exceeds FLOW JSON/1 byte limit");
      }
      ensureCapacity(nextLength);
      buffer.set(remainder, length);
      length = nextLength;
    }
  }

  if (length !== 0) throw new FramingViolation("incomplete frame at EOF");

  function ensureCapacity(required: number): void {
    if (buffer.byteLength >= required) return;
    let capacity = buffer.byteLength;
    while (capacity < required) {
      capacity = Math.min(MAX_FRAME_BYTES, capacity * 2);
      if (capacity < required && capacity === MAX_FRAME_BYTES) {
        throw new FramingViolation("frame exceeds FLOW JSON/1 byte limit");
      }
    }
    const grown = new Uint8Array(capacity);
    grown.set(buffer.subarray(0, length));
    buffer = grown;
  }
}
