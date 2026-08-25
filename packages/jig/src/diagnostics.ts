export type DiagnosticKind = "invalid" | "unavailable";

export class CheckError extends Error {
  readonly kind: DiagnosticKind;
  readonly code: string;
  readonly path?: string;
  readonly pointer?: string;

  constructor(
    kind: DiagnosticKind,
    code: string,
    message: string,
    path?: string,
    pointer?: string,
  ) {
    super(message);
    this.name = "CheckError";
    this.kind = kind;
    this.code = code;
    if (path !== undefined) this.path = path;
    if (pointer !== undefined) this.pointer = pointer;
  }
}

export function invalid(code: string, message: string, path?: string, pointer?: string): never {
  throw new CheckError("invalid", code, message, path, pointer);
}

export function unavailable(code: string, message: string, path?: string, pointer?: string): never {
  throw new CheckError("unavailable", code, message, path, pointer);
}
