import { createHash } from 'node:crypto'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

// Genuine clients for offline hosted qualification; never a consumer installer.
const root = process.argv[2]
if (process.platform !== 'darwin' || !root || !isAbsolute(root)) throw Error('absolute Mac fixture directory required')
if (!['x64', 'arm64'].includes(process.arch)) throw Error('unsupported candidate architecture')
await mkdir(root, { mode: 0o700 })
const arm = process.arch === 'arm64'
const arch = arm ? 'arm64' : 'x64'
const archives = [
  {
    name: 'codex', algorithm: 'sha512',
    url: `https://registry.npmjs.org/@openai/codex/-/codex-0.152.1-darwin-${arch}.tgz`,
    digest: arm ? 'H8i0uZHILM0Z2Ep+MryCF5rGXmXjmXTzXf5ZK6bobKtZc2yfomi42ZrQWuYQ5P02H0oLG7B5jLaSWZQ+VFgjbA==' : 'M2qW7YkRx+JeSFoZQsrjgA5yNglowuNAFOwRJoIjlgeP8bsyOqPtbSolu3w4Us7IyCH8f/yuKtlt/v/MdDqbfA==',
    executable: `vendor/${arm ? 'aarch64' : 'x86_64'}-apple-darwin/bin/codex`,
  },
  {
    name: 'claude', algorithm: 'sha512',
    url: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-${arch}/-/claude-agent-sdk-darwin-${arch}-0.3.257.tgz`,
    digest: arm ? 'ITjFPYB8riu9tbxbrWArokiZ/90w/NDrYbtEvyr3ScilVtu1iupkComxkhvbUxoyT4JRDpKsdw/ZOfwSl/pkpA==' : '0s7QoLRnopbMvCqVpgCnvBWg4UNxPUybMZTknkn3HLBMvUjUdHs1QXb77c/yrT1WAPqDTw1Ju+H0esXwWa8/Kg==',
    executable: 'claude',
  },
  {
    name: 'pi', algorithm: 'sha256',
    url: `https://github.com/earendil-works/pi/releases/download/v0.84.4/pi-darwin-${arch}.tar.gz`,
    digest: arm ? 'c68e3ac4d05b4e282aaab2e6c76f161d3e9e68f19a22e38913cbfaadb6c800f0' : '7a042d6413065421387001a4986190a1a03186c95a695f4dee0bdc76e60de8f7',
    executable: 'pi',
  },
]
for (const archive of archives) {
  const response = await fetch(archive.url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw Error(`client download failed: ${archive.name}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = createHash(archive.algorithm).update(bytes).digest(archive.algorithm === 'sha512' ? 'base64' : 'hex')
  if (actual !== archive.digest) throw Error(`client archive identity changed: ${archive.name}`)
  const directory = join(root, archive.name), path = join(root, `${archive.name}.tgz`)
  await mkdir(directory, { mode: 0o700 })
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  const child = Bun.spawn(['/usr/bin/tar', '-xzf', path, '--strip-components=1', '-C', directory], { stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw Error(`client extraction failed: ${archive.name}`)
  const executable = join(directory, archive.executable)
  await access(executable, 1)
  console.log(`JIG_${archive.name.toUpperCase()}_STARTUP_PATH=${executable}`)
}
