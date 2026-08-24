import { setTimeout as delay } from "node:timers/promises";

import { parseFrame } from "./json1";

const encoder = new TextEncoder();
const MAX_FRAME_BYTES = 16_777_216;

export type Message = Record<string, unknown>;

interface Waiter {
  resolve(message: Message): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class ComponentPeer {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly pumpDone: Promise<void>;
  private buffer = new Uint8Array();
  private readonly messages: Message[] = [];
  private readonly waiters: Waiter[] = [];
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
  }

  send(message: Message): void {
    this.sendBytes(encoder.encode(`${JSON.stringify(message)}\n`));
  }

  sendBytes(bytes: Uint8Array): void {
    this.process.stdin.write(bytes);
    this.process.stdin.flush();
  }

  async receive(timeoutMs = 3_000): Promise<Message> {
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
    await this.pumpDone;
  }

  async exit(timeoutMs = 3_000): Promise<number> {
    return await Promise.race([
      this.process.exited,
      delay(timeoutMs).then(() => {
        this.process.kill();
        throw new Error(`component did not exit after ${timeoutMs}ms`);
      }),
    ]);
  }

  async finish(timeoutMs = 3_000): Promise<void> {
    this.closeInput();
    const exitCode = await this.exit(timeoutMs);
    await this.pumpDone;
    if (exitCode !== 0) {
      throw new Error(`component exited ${exitCode}: ${await this.stderr()}`);
    }
    if (this.terminalError) throw this.terminalError;
    if (this.messages.length !== 0) {
      throw new Error(`component emitted ${this.messages.length} unexpected frame(s)`);
    }
  }

  async stderr(): Promise<string> {
    return await new Response(this.process.stderr).text();
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
