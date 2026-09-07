import type { LogRecord } from './parse.ts'

export function report(records: LogRecord[]) {
  return {
    requests: records.length,
    clientErrors: records.filter((r) => r.status >= 400 && r.status < 500).length,
    serverErrors: records.filter((r) => r.status >= 400).length,
  }
}
