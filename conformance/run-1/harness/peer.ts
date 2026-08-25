import { setTimeout as delay } from "node:timers/promises";

import { parseFrame } from "./json1";

const encoder = new TextEncoder();
const MAX_FRAME_BYTES = 16_777_216;
const MAX_DIAGNOSTIC_BYTES = 65_536;
const MAX_REQUEST_IDS = 65_536;

export type Message = Record<string, unknown>;

interface Waiter {
  resolve(message: Message): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class ComponentPeer {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly pumpDone: Promise<void>;
  private readonly diagnostics: Promise<string>;
  private buffer = new Uint8Array();
  private readonly messages: Message[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly componentRequestIds = new Set<string>();
  private terminalError?: Error;
  private ended = false;

  readonly process: ReturnType<typeof Bun.spawn>;

  constructor(command: readonly string[], environment: Record<string, string | undefined> = {}) {
    this.process = Bun.spawn({
      cmd: [...command],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...environment },
    });
    this.reader = this.process.stdout.getReader();
    this.pumpDone = this.pump();
    // Run/1 permits diagnostics on stderr. Drain it immediately so a noisy
    // component cannot block before reaching its terminal state.
    this.diagnostics = drainDiagnostics(this.process.stderr);
  }

  send(message: Message): void {
    this.sendBytes(encoder.encode(`${JSON.stringify(message)}\n`));
  }

  sendBytes(bytes: Uint8Array): void {
    this.process.stdin.write(bytes);
    this.process.stdin.flush();
  }

  async receive(timeoutMs = 10_000): Promise<Message> {
    const message = this.messages.shift();
    if (message) return message;
    if (this.terminalError) throw this.terminalError;
    if (this.ended) throw new Error("component stdout closed");

    return await new Promise<Message>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error(`timed out waiting for component frame after ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  closeInput(): void {
    this.process.stdin.end();
  }

  async dispose(): Promise<void> {
    try {
      this.process.stdin.end();
    } catch {
      // The component may already have closed its side of the channel.
    }
    try {
      this.process.kill();
    } catch {
      // Killing an already-exited process is harmless cleanup.
    }
    await this.process.exited;
    await Promise.all([this.pumpDone, this.diagnostics]);
  }

  async exit(timeoutMs = 10_000): Promise<number> {
    return await Promise.race([
      this.process.exited,
      delay(timeoutMs).then(() => {
        this.process.kill();
        throw new Error(`component did not exit after ${timeoutMs}ms`);
      }),
    ]);
  }

  async finish(timeoutMs = 10_000): Promise<void> {
    this.closeInput();
    const exitCode = await this.exit(timeoutMs);
    await Promise.all([this.pumpDone, this.diagnostics]);
    if (exitCode !== 0) {
      throw new Error(`component exited ${exitCode}: ${await this.stderr()}`);
    }
    if (this.terminalError) throw this.terminalError;
    if (this.messages.length !== 0) {
      throw new Error(`component emitted ${this.messages.length} unexpected frame(s)`);
    }
  }

  async stderr(): Promise<string> {
    return await this.diagnostics;
  }

  private async pump(): Promise<void> {
    try {
      while (true) {
        const lf = this.buffer.indexOf(0x0a);
        if (lf >= 0) {
          const frame = this.buffer.subarray(0, lf + 1);
          this.buffer = this.buffer.slice(lf + 1);
          const parsed = parseFrame(frame);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("component frame is not a JSON object");
          }
          this.deliver(parsed as Message);
          continue;
        }

        if (this.buffer.byteLength > MAX_FRAME_BYTES) {
          throw new Error("component frame is oversized");
        }
        const { value, done } = await this.reader.read();
        if (done) {
          if (this.buffer.byteLength !== 0) {
            throw new Error("component stdout closed with a partial frame");
          }
          this.ended = true;
          this.rejectWaiters(new Error("component stdout closed"));
          return;
        }
        this.buffer = concat(this.buffer, value);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private deliver(message: Message): void {
    if (Object.hasOwn(message, "method") && Object.hasOwn(message, "id")) {
      const id = message.id;
      if (typeof id !== "string") {
        this.fail(new Error("component emitted an invalid request ID"));
        return;
      }
      if (this.componentRequestIds.has(id)) {
        this.fail(new Error(`component reused request ID ${id}`));
        return;
      }
      if (this.componentRequestIds.size >= MAX_REQUEST_IDS) {
        this.fail(new Error("component exceeded the Run/1 request-ID lifetime limit"));
        return;
      }
      this.componentRequestIds.add(id);
    }
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.messages.push(message);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }

  private fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    this.rejectWaiters(error);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}

async function drainDiagnostics(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const remaining = MAX_DIAGNOSTIC_BYTES - length;
    if (remaining > 0) {
      const kept = value.slice(0, remaining);
      chunks.push(kept);
      length += kept.byteLength;
    }
    if (value.byteLength > remaining) truncated = true;
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return truncated ? `${text}\n[stderr truncated]` : text;
}
