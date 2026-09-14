import type { RunContext, RunResult } from '@jigging/flow'

export async function runMethod(run: Pick<RunContext, 'input'>): Promise<RunResult> {
  const { headers } = run.input as { headers: string[] }
  const expected = ['Customer', 'Email address', 'Company']
  if (headers.length !== 3 || expected.some((h) => !headers.includes(h)))
    return { outcome: 'done', output: { mapping: null } }
  return {
    outcome: 'done',
    output: {
      mapping: {
        name: headers.indexOf('Customer'),
        email: headers.indexOf('Email address'),
        organization: headers.indexOf('Company'),
      },
    },
  }
}
