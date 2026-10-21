import { expect, test } from 'bun:test'
import { evaluate } from '../flows/repair/evidence.ts'
import { candidate, digest, parseInput, parseProposal } from '../flows/repair/policy.ts'
import { commandRecordData, input, proposal } from './fixture.ts'

test('candidate data retains original tests and hashes selected replacement bytes', () => {
  const files = candidate(input, parseProposal(proposal, input))
  expect(files['test/project.test.ts']).toBe(input.files['test/project.test.ts'])
  expect(digest(files)).not.toBe(digest(input.files))
  for (const replacement of proposal.replacements)
    expect(files[replacement.path]).toBe(replacement.content)
})

test('project and replacement bounds reject traversal, test edits, duplicates and invalid Unicode', () => {
  expect(parseInput(input)).toEqual(input)
  for (const replacements of [
    [{ path: '../outside.ts', content: '' }],
    [{ path: 'test/project.test.ts', content: '' }],
    [proposal.replacements[0], proposal.replacements[0]],
    [{ path: 'src/parse.ts', content: '\ud800' }],
  ])
    expect(() => parseProposal({ ...proposal, replacements }, input)).toThrow()
  expect(() =>
    parseInput({ ...input, files: { ...input.files, 'src/../../secret': '' } }),
  ).toThrow()
  expect(() =>
    parseInput({ ...input, files: { ...input.files, 'src/large.ts': 'x'.repeat(65537) } }),
  ).toThrow()
})

test('pure evaluation rejects pass flags and mismatched command identity in record data', () => {
  const records = [
    commandRecordData('tests', input.files, [], '', true),
    ...input.cases.map((c) => commandRecordData('cli', input.files, c.args, c.stdin, false)),
  ]
  for (const r of records.slice(1)) r.stdout.text = '{"passed":true}\n'
  expect(evaluate(input, input.files, records)).toMatchObject({
    repositoryTestsPassed: true,
    accepted: false,
  })
  records[1]!.candidateDigest = 'sha256:' + '0'.repeat(64)
  expect(() => evaluate(input, input.files, records)).toThrow('identity')
})
