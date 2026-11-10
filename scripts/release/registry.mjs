// A genuine disposable npm registry. The proxy changes transport outcomes only.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

function resolveVerdaccioBinary() {
  if (process.env.VERDACCIO_BIN && existsSync(process.env.VERDACCIO_BIN)) {
    return process.env.VERDACCIO_BIN
  }
  const isolatedServer = resolve(import.meta.dirname, 'registry-server')
  const isolatedBin = resolve(isolatedServer, 'node_modules/verdaccio/bin/verdaccio')
  if (existsSync(isolatedBin)) return isolatedBin
  const rootBin = resolve(import.meta.dirname, '../../node_modules/verdaccio/bin/verdaccio')
  if (existsSync(rootBin)) return rootBin
  if (existsSync(join(isolatedServer, 'package.json'))) {
    execFileSync('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], {
      cwd: isolatedServer,
      stdio: 'inherit',
    })
    if (existsSync(isolatedBin)) return isolatedBin
  }
  throw new Error('Verdaccio binary not found; run bun install --cwd scripts/release/registry-server')
}

export async function startRegistry(root, { externalDependencies = false } = {}) {
  await mkdir(root, { recursive: true })
  const configuration = join(root, 'verdaccio.json')
  await writeFile(
    configuration,
    JSON.stringify({
      storage: join(root, 'storage'),
      max_body_size: '64mb',
      auth: { htpasswd: { file: join(root, 'htpasswd') } },
      uplinks: externalDependencies ? { npmjs: { url: 'https://registry.npmjs.org/' } } : {},
      packages: {
        ...Object.fromEntries(
          [
            'flow',
            'reporting',
            'agent-method',
            'agent-acp',
            'semantic-router',
            'jig',
            'display-model',
            'display-web',
            'display-tui',
          ].map((name) => [`@jigging/${name}`, { access: '$all', publish: '$authenticated' }]),
        ),
        '**': {
          access: '$all',
          publish: '$authenticated',
          unpublish: '$authenticated',
          ...(externalDependencies ? { proxy: 'npmjs' } : {}),
        },
      },
      log: { type: 'stdout', format: 'json', level: 'error' },
      security: { api: { jwt: { sign: { expiresIn: '1h' } } } },
    }),
  )
  // Let the OS select the port, then release it before Verdaccio binds.
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve, reject) => reservation.close((e) => (e ? reject(e) : resolve())))
  const upstream = `http://127.0.0.1:${port}`
  const child = spawn(
    process.execPath,
    [
      resolveVerdaccioBinary(),
      '--config',
      configuration,
      '--listen',
      upstream,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        NODE_NO_WARNINGS: '1',
        ...(externalDependencies
          ? Object.fromEntries(
              ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']
                .filter((key) => process.env[key])
                .map((key) => [key, process.env[key]]),
            )
          : {}),
      },
    },
  )
  let diagnostic = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      diagnostic = (diagnostic + data).slice(-8192)
    })
  let childError
  const exit = once(child, 'exit').catch((error) => {
    childError = error
  })
  let fault = null
  const traffic = []
  const proxy = createServer((incoming, outgoing) => {
    traffic.push({ method: incoming.method, path: incoming.url })
    const rule = fault?.(incoming)
    if (rule?.status) {
      incoming.resume()
      outgoing.writeHead(rule.status, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify({ error: rule.status === 404 ? 'not found' : 'access refused' }))
      return
    }
    const forwarded = httpRequest(
      upstream + incoming.url,
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: `127.0.0.1:${port}` },
      },
      (response) => {
        if (rule?.loseResponse) {
          response.resume()
          response.once('end', () => outgoing.destroy())
        } else {
          outgoing.writeHead(response.statusCode, response.headers)
          response.pipe(outgoing)
        }
      },
    )
    forwarded.on('error', () => {
      outgoing.writeHead(502)
      outgoing.end()
    })
    incoming.pipe(forwarded)
  })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    proxy.closeAllConnections()
    if (proxy.listening)
      await new Promise((resolve, reject) => proxy.close((e) => (e ? reject(e) : resolve())))
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      try {
        await exit
      } finally {
        clearTimeout(timer)
      }
    }
  }
  try {
    const deadline = Date.now() + 15_000
    while (true) {
      if (childError) throw childError
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error(`Verdaccio exited: ${diagnostic}`)
      try {
        const response = await fetch(`${upstream}/-/ping`, { signal: AbortSignal.timeout(500) })
        await response.arrayBuffer()
        if (response.ok) break
      } catch {}
      if (Date.now() >= deadline) throw Error(`Verdaccio startup deadline: ${diagnostic}`)
      await delay(50)
    }
    const password = randomBytes(32).toString('hex')
    const response = await fetch(`${upstream}/-/user/org.couchdb.user:rehearsal`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'rehearsal',
        password,
        email: 'rehearsal@localhost',
        type: 'user',
        roles: [],
      }),
      signal: AbortSignal.timeout(5000),
    })
    await response.body?.cancel()
    assert.ok(response.ok, 'Local registry user creation failed')
    proxy.listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    const registry = `http://127.0.0.1:${proxy.address().port}`
    const userconfig = join(root, 'npmrc')
    await writeFile(
      userconfig,
      `//127.0.0.1:${proxy.address().port}/:_auth=${Buffer.from(`rehearsal:${password}`).toString('base64')}\n`,
      {
        mode: 0o600,
      },
    )
    return {
      registry,
      userconfig,
      traffic,
      close,
      setFault(value) {
        fault = value
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}

export function npmEnvironment(root, userconfig) {
  // Credentials from the operator and GitHub never reach local registry tests.
  return {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    npm_config_userconfig: userconfig,
    npm_config_globalconfig: join(root, 'empty-npmrc'),
    npm_config_cache: join(root, 'npm-cache'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_fetch_retries: '0',
    npm_config_fetch_timeout: '10000',
  }
}

export async function command(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (data) => {
    stdout = (stdout + data).slice(-1024 * 1024)
  })
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-1024 * 1024)
  })
  const terminate = () => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  const timer = setTimeout(terminate, 120_000)
  try {
    const [status, signal] = await once(child, 'exit')
    return { status, signal, stdout, stderr }
  } finally {
    clearTimeout(timer)
    terminate()
  }
}
