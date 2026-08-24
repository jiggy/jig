export type DiagnosticKind = "invalid" | "unavailable";

export class CheckError extends Error {
  readonly kind: DiagnosticKind;
  readonly code: string;
  readonly path?: string;

  constructor(
    kind: DiagnosticKind,
    code: string,
    message: string,
    path?: string,
  ) {
    super(message);
    this.name = "CheckError";
    this.kind = kind;
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

export function invalid(code: string, message: string, path?: string): never {
  throw new CheckError("invalid", code, message, path);
}

export function unavailable(code: string, message: string, path?: string): never {
  throw new CheckError("unavailable", code, message, path);
}
