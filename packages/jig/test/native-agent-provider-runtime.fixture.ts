import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateClaudeAgentProvider } from '../src/internal/claude-agent-provider.js'
import { nativeElf } from './fixtures/native-elf.js'
import { nativeMachO } from './fixtures/native-macho.js'

const temporary: string[] = []
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-native-provider-runtime-')))
  temporary.push(root)
  const project = join(root, 'project')
  const install = join(root, 'operator')
  const release = join(root, 'release')
  const agent = join(release, 'libexec', 'agent')
  await Promise.all(
    [project, agent].map((path) => mkdir(path, { recursive: true })),
  )
  const executable = join(install, 'claude')
  const library = join(install, 'libfixture.so')
  const paths: Record<string, string> = {
    executable,
    library,
    launcher: join(agent, 'claude-agent-launcher.js'),
    adapter: join(agent, 'claude-agent-acp.js'),
  }
  await Promise.all([
    writeFile(
      executable,
      process.platform === 'darwin'
        ? nativeMachO({ needed: ['@loader_path/libfixture.so'] })
        : nativeElf({ needed: ['libfixture.so'], search: '$ORIGIN' }),
      {
        mode: 0o700,
      },
    ),
    writeFile(library, process.platform === 'darwin' ? nativeMachO({ library }) : nativeElf()),
    writeFile(paths.launcher!, 'launcher', { mode: 0o700 }),
    writeFile(paths.adapter!, 'adapter'),
  ])
  const environment: Record<string, string> = {
    PATH: install,
    ANTHROPIC_API_KEY: 'test-secret',
    ANTHROPIC_MODEL: 'test-model',
  }
  const opener = openPrivateClaudeAgentProvider
  return {
    root,
    project,
    paths,
    executable,
    library,
    environment,
    open: () => opener(release, environment, project),
  }
}

export { fixture, temporary }
