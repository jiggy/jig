import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateClaudeAgentProvider } from '../src/internal/claude-agent-provider.js'
import { openPrivatePiAgentProvider } from '../src/internal/pi-agent-provider.js'
import { nativeElf } from './fixtures/native-elf.js'
import { nativeMachO } from './fixtures/native-macho.js'

const temporary: string[] = []
async function fixture(client: 'claude' | 'pi') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-native-provider-runtime-')))
  temporary.push(root)
  const project = join(root, 'project')
  const install = join(root, 'operator')
  const release = join(root, 'release')
  const agent = join(release, 'libexec', 'agent')
  await Promise.all(
    [project, agent, join(install, 'theme')].map((path) => mkdir(path, { recursive: true })),
  )
  const executable = join(install, client)
  const library = join(install, 'libfixture.so')
  const paths: Record<string, string> = {
    executable,
    library,
    launcher: join(agent, `${client}-agent-launcher.js`),
    adapter: join(agent, client === 'claude' ? 'claude-agent-acp.js' : 'pi-acp.js'),
    manifest: join(install, 'package.json'),
    dark: join(install, 'theme', 'dark.json'),
    light: join(install, 'theme', 'light.json'),
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
    writeFile(
      paths.manifest!,
      JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '0.84.4' }),
    ),
    writeFile(paths.dark!, '{}'),
    writeFile(paths.light!, '{}'),
  ])
  const environment: Record<string, string> =
    client === 'claude'
      ? {
          PATH: install,
          ANTHROPIC_API_KEY: 'test-secret',
          ANTHROPIC_MODEL: 'test-model',
        }
      : { PATH: install, PI_PROVIDER: 'mistral', PI_MODEL: 'test-model', PI_API_KEY: 'test-secret' }
  const opener = client === 'claude' ? openPrivateClaudeAgentProvider : openPrivatePiAgentProvider
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
