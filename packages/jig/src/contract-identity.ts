const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const PATH_SEGMENT = /^[a-z0-9._~-]+$/
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

/** Canonical, inert contract identity: never a request to fetch a URL. */
export function isContractId(value: string): boolean {
  if (!value.startsWith('https://')) return false
  const remainder = value.slice('https://'.length)
  const separator = remainder.indexOf('/')
  if (separator <= 0 || separator === remainder.length - 1) return false
  const labels = remainder.slice(0, separator).split('.')
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return false
  if (
    labels.length === 4 &&
    labels.every((label) => /^[0-9]{1,3}$/.test(label) && Number(label) <= 255)
  )
    return false
  return remainder
    .slice(separator + 1)
    .split('/')
    .every((segment) => segment !== '.' && segment !== '..' && PATH_SEGMENT.test(segment))
}

export function isContractVersion(value: string): boolean {
  return VERSION.test(value)
}
