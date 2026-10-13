import { isAbsolute, relative } from 'node:path'

const escapeXml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

// Node's bundled JUnit reporter omits file identities. Preserve the actual
// event file so the same whole-file evidence check can own Node and Bun suites.
export default async function* sourceNodeReporter(events) {
  const cases = []
  let completed = false
  for await (const event of events) {
    if (
      (event.type === 'test:summary' && event.data.topLevel) ||
      (event.type === 'test:plan' && event.data.nesting === 0 && event.data.count > 0)
    )
      completed = true
    if (!['test:pass', 'test:fail'].includes(event.type) || event.data.details?.type === 'suite')
      continue
    const file = relative(process.cwd(), event.data.file ?? '')
    if (!file || file.startsWith('../') || isAbsolute(file))
      throw new Error('Node case has no repository file identity')
    if (
      event.type === 'test:pass' &&
      (event.data.name === event.data.file ||
        event.data.name === file ||
        event.data.name === `./${file}`)
    )
      throw new Error('Node source file registers no actual test cases')
    const skipped = event.data.skip || event.data.todo
    cases.push(
      `<testcase file="${escapeXml(file)}" classname="node" name="${escapeXml(event.data.name)}">${skipped ? '<skipped/>' : event.type === 'test:fail' ? '<failure/>' : ''}</testcase>`,
    )
  }
  if (!completed || !cases.length) throw new Error('Node source report is incomplete or empty')
  yield `<?xml version="1.0" encoding="utf-8"?><testsuites tests="${cases.length}">${cases.join('')}</testsuites>\n`
}
