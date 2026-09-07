export interface LogRecord {
  path: string
  status: number
}

export function parse(line: string): LogRecord {
  const value = JSON.parse(line)
  if (!value || typeof value.path !== 'string' || typeof value.status !== 'number')
    throw new TypeError('Invalid log')
  return { path: value.path, status: value.status }
}
