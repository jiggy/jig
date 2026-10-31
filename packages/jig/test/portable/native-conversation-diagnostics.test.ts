import { expect, test } from 'bun:test'
import { OperationError } from '@jigging/flow'
import { nativeConversationErrorDiagnostic } from '../fixtures/native-conversation-diagnostics.js'

const privateText = 'PRIVATE_CREDENTIAL_PATH_RECEIPT_PROVIDER_PAYLOAD'
const uncertainPrefix = 'Finite ACP dispatch may have occurred but no result was proved while '
const sessionFailure =
  ' The native client reported a session failure; private details were withheld.'
const protocolFailure = ' The finite ACP exchange violated its validated protocol.'

function project(...errors: unknown[]) {
  return nativeConversationErrorDiagnostic(new AggregateError(errors, privateText))
}

function requestError(details: unknown) {
  const error = new OperationError('EXECUTION_FAILED', privateText)
  Object.defineProperty(error, 'details', { value: details, configurable: true })
  return error
}

function sessionError(details: unknown) {
  const error = new OperationError(
    'UNCERTAIN',
    `${uncertainPrefix}exchanging native messages.${sessionFailure}`,
  )
  Object.defineProperty(error, 'details', { value: details, configurable: true })
  return error
}

test('native diagnostics preserve every public operation code and fixed helper cause', () => {
  for (const code of [
    'CANCELLED',
    'DEADLINE_EXCEEDED',
    'OWNER_CLOSED',
    'OPERATION_CONFLICT',
    'UNAVAILABLE',
    'PERMISSION_DENIED',
    'RESOURCE_EXHAUSTED',
    'INVALID_INPUT',
    'INVALID_RESULT',
    'UNCERTAIN',
    'EXECUTION_FAILED',
    'LAGGED',
    'DISCONNECTED',
    'PROTOCOL_ERROR',
    'CHANNEL_LOST',
  ] as const) {
    expect(project(new OperationError(code, privateText, { privateText }))).toEqual({
      errorCount: 1,
      errorsTruncated: false,
      errors: [{ kind: 'operation', code }],
    })
  }
  for (const cause of [
    'Agent replies ended before accepted conversation close',
    'Agent reply has an unexpected turn',
    'Agent sent an out-of-order turn result',
    'Agent sent an unexpected control reply',
    'Application left a live Agent turn unfinished',
    'Agent omitted matching conversation settlement',
  ]) {
    expect(project(new Error(cause)).errors).toEqual([{ kind: 'helper', cause }])
  }
  const unknown = new OperationError('UNCERTAIN', privateText)
  Object.defineProperty(unknown, 'code', { value: privateText })
  const diagnostic = project(unknown, new Error(privateText), { message: privateText }, privateText)
  expect(diagnostic.errors).toEqual([
    { kind: 'operation', code: 'other' },
    { kind: 'helper', cause: 'unclassified' },
    { kind: 'helper', cause: 'unclassified' },
    { kind: 'helper', cause: 'unclassified' },
  ])
  expect(JSON.stringify(diagnostic)).not.toContain(privateText)
})

test('native diagnostics project only exact post-dispatch phase and policy messages', () => {
  for (const [text, phase] of [
    ['starting the native client', 'start-client'],
    ['exchanging native messages', 'exchange-messages'],
    ['collecting authorized session state', 'collect-session'],
    ['fencing and cleanup', 'fence-cleanup'],
  ]) {
    for (const [suffix, reason] of [
      ['', 'unclassified'],
      [sessionFailure, 'native-session'],
      [protocolFailure, 'protocol'],
    ]) {
      expect(
        project(new OperationError('UNCERTAIN', `${uncertainPrefix}${text}.${suffix}`)).errors,
      ).toEqual([{ kind: 'operation', code: 'UNCERTAIN', native: { phase, reason } }])
    }
  }
  expect(
    project(
      new OperationError(
        'UNCERTAIN',
        'the native provider did not prove an ordinary or controlled terminal',
      ),
    ).errors,
  ).toEqual([
    {
      kind: 'operation',
      code: 'UNCERTAIN',
      native: { phase: 'terminal', reason: 'unproved-terminal' },
    },
  ])
})

test('near matches and other codes never acquire native phase or reason claims', () => {
  const exact = `${uncertainPrefix}exchanging native messages.${sessionFailure}`
  for (const message of [
    `${privateText}${exact}`,
    `${exact}${privateText}`,
    `${exact}\n`,
    exact.replace('native messages', privateText),
    exact.replace('Finite ACP', 'finite ACP'),
    `${uncertainPrefix}verifying the admitted runtime.${sessionFailure}`,
    `${uncertainPrefix}restoring the authorized session.${sessionFailure}`,
    `${uncertainPrefix}preparing containment.${sessionFailure}`,
    `${uncertainPrefix}exchanging native messages. The native client reported ${privateText}`,
    `the native provider did not prove an ordinary or controlled terminal ${privateText}`,
  ]) {
    const diagnostic = project(new OperationError('UNCERTAIN', message))
    expect(diagnostic.errors).toEqual([{ kind: 'operation', code: 'UNCERTAIN' }])
    expect(JSON.stringify(diagnostic)).not.toContain(privateText)
  }
  for (const code of ['EXECUTION_FAILED', 'OWNER_CLOSED', 'DEADLINE_EXCEEDED'] as const)
    expect(project(new OperationError(code, exact)).errors).toEqual([{ kind: 'operation', code }])
})

test('native session diagnostics retain only exact categories with the matching failure', () => {
  for (const category of ['connection', 'access', 'limit', 'request', 'service', 'unknown']) {
    const details = { nativeSession: { category } }
    expect(project(sessionError(details)).errors).toEqual([
      {
        kind: 'operation',
        code: 'UNCERTAIN',
        native: { phase: 'exchange-messages', reason: 'native-session', category },
      },
    ])
    for (const code of ['EXECUTION_FAILED', 'CANCELLED', 'DEADLINE_EXCEEDED'] as const)
      expect(
        project(
          new OperationError(
            code,
            `${uncertainPrefix}exchanging native messages.${sessionFailure}`,
            details,
          ),
        ).errors,
      ).toEqual([{ kind: 'operation', code }])
    for (const [message, native] of [
      [
        `${uncertainPrefix}exchanging native messages.${protocolFailure}`,
        { phase: 'exchange-messages', reason: 'protocol' },
      ],
      [
        `${uncertainPrefix}exchanging native messages.`,
        { phase: 'exchange-messages', reason: 'unclassified' },
      ],
      [
        'the native provider did not prove an ordinary or controlled terminal',
        { phase: 'terminal', reason: 'unproved-terminal' },
      ],
    ] as const)
      expect(project(new OperationError('UNCERTAIN', message, details)).errors).toEqual([
        { kind: 'operation', code: 'UNCERTAIN', native },
      ])
    expect(project(new OperationError('UNCERTAIN', privateText, details)).errors).toEqual([
      { kind: 'operation', code: 'UNCERTAIN' },
    ])
  }
})

test('native HTTP diagnostics keep reported error statuses and discard malformed optional values', () => {
  for (const status of [
    400,
    401,
    402,
    429,
    500,
    503,
    599,
    399,
    600,
    500.5,
    '503',
    null,
    {},
    privateText,
  ]) {
    const expected =
      typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
        ? { httpStatusCode: status }
        : {}
    const details = { nativeSession: { category: 'service', httpStatusCode: status } }
    const diagnostic = project(sessionError(details))
    expect(diagnostic.errors).toEqual([
      {
        kind: 'operation',
        code: 'UNCERTAIN',
        native: {
          phase: 'exchange-messages',
          reason: 'native-session',
          category: 'service',
          ...expected,
        },
      },
    ])
    expect(JSON.stringify(diagnostic)).not.toContain(privateText)
    const cancelled = new OperationError('CANCELLED', uncertainPrefix, details)
    expect(project(cancelled).errors).toEqual([{ kind: 'operation', code: 'CANCELLED' }])
  }
  let reads = 0
  const session = Object.defineProperty({ category: 'service' }, 'httpStatusCode', {
    get() {
      reads++
      throw Error(privateText)
    },
  })
  expect(project(sessionError({ nativeSession: session })).errors).toEqual([
    {
      kind: 'operation',
      code: 'UNCERTAIN',
      native: { phase: 'exchange-messages', reason: 'native-session' },
    },
  ])
  expect(reads).toBe(0)
})

test('native session diagnostics reject unknown fields and malformed category records', () => {
  const session = { category: 'connection' }
  const unexpected = [
    undefined,
    null,
    [],
    privateText,
    {},
    { nativeSession: session, payload: privateText },
    { nativeSession: { ...session, title: privateText } },
    { nativeSession: { ...session, actions: ['retry'] } },
    ...[undefined, null, 1, {}, [], privateText, 'constructor', 'Connection', 'connection\n'].map(
      (category) => ({ nativeSession: { category } }),
    ),
    Object.create({ nativeSession: session }),
    { nativeSession: Object.create(session) },
    { nativeSession: session, [Symbol('private')]: privateText },
    { nativeSession: { ...session, [Symbol('private')]: privateText } },
    Object.defineProperty({ nativeSession: session }, 'hidden', { value: privateText }),
    { nativeSession: Object.defineProperty({ ...session }, 'hidden', { value: privateText }) },
  ]
  for (const details of unexpected) {
    const diagnostic = project(sessionError(details))
    expect(diagnostic.errors).toEqual([
      {
        kind: 'operation',
        code: 'UNCERTAIN',
        native: { phase: 'exchange-messages', reason: 'native-session' },
      },
    ])
    expect(JSON.stringify(diagnostic)).not.toContain(privateText)
  }
})

test('native category observation cannot invoke accessors or discard known failure facts', () => {
  let reads = 0
  const accessor = {
    get() {
      reads++
      throw new Error(privateText)
    },
  }
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  for (const details of [
    Object.defineProperty({}, 'nativeSession', accessor),
    { nativeSession: Object.defineProperty({}, 'category', accessor) },
    revoked.proxy,
    { nativeSession: revoked.proxy },
  ]) {
    expect(project(sessionError(details)).errors).toEqual([
      {
        kind: 'operation',
        code: 'UNCERTAIN',
        native: { phase: 'exchange-messages', reason: 'native-session' },
      },
    ])
  }
  const error = sessionError(undefined)
  Object.defineProperty(error, 'details', accessor)
  expect(project(error).errors).toEqual([
    {
      kind: 'operation',
      code: 'UNCERTAIN',
      native: { phase: 'exchange-messages', reason: 'native-session' },
    },
  ])
  expect(reads).toBe(0)
})

test('native request diagnostics retain exact allowed methods and safe integer codes', () => {
  for (const method of [
    'initialize',
    'session/new',
    'session/resume',
    'session/set_config_option',
    'session/set_mode',
    'session/prompt',
  ]) {
    for (const code of [-32603, 0, Number.MAX_SAFE_INTEGER]) {
      expect(project(requestError({ nativeRequest: { method, code } })).errors).toEqual([
        { kind: 'operation', code: 'EXECUTION_FAILED', nativeRequest: { method, code } },
      ])
    }
  }
  const nativeRequest = {
    method: 'session/new',
    code: -32603,
    reason: 'managed-preferences-unavailable',
  }
  expect(project(requestError({ nativeRequest })).errors).toEqual([
    { kind: 'operation', code: 'EXECUTION_FAILED', nativeRequest },
  ])
})

test('native request diagnostics reject unknown fields, methods, reasons and code shapes', () => {
  const request = { method: 'session/new', code: -32603 }
  const unexpected = [
    null,
    [],
    privateText,
    { nativeRequest: request, payload: privateText },
    { nativeRequest: { ...request, payload: privateText } },
    { nativeRequest: { ...request, method: privateText } },
    { nativeRequest: { ...request, method: 'constructor' } },
    { nativeRequest: { ...request, method: 'session/new\n' } },
    { nativeRequest: { ...request, reason: privateText } },
    { nativeRequest: { ...request, reason: undefined } },
    {
      nativeRequest: {
        ...request,
        method: 'session/resume',
        reason: 'managed-preferences-unavailable',
      },
    },
    { nativeRequest: { ...request, code: 1, reason: 'managed-preferences-unavailable' } },
    ...[NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '-32603', null].map((code) => ({
      nativeRequest: { ...request, code },
    })),
    Object.create({ nativeRequest: request }),
    { nativeRequest: Object.create(request) },
    { nativeRequest: request, [Symbol('private')]: privateText },
    { nativeRequest: { ...request, [Symbol('private')]: privateText } },
    Object.defineProperty({ nativeRequest: request }, 'hidden', { value: privateText }),
    { nativeRequest: Object.defineProperty({ ...request }, 'hidden', { value: privateText }) },
  ]
  for (const details of unexpected) {
    const diagnostic = project(requestError(details))
    expect(diagnostic.errors).toEqual([{ kind: 'operation', code: 'EXECUTION_FAILED' }])
    expect(JSON.stringify(diagnostic)).not.toContain(privateText)
  }
  expect(
    project(new OperationError('UNCERTAIN', privateText, { nativeRequest: request })).errors,
  ).toEqual([{ kind: 'operation', code: 'UNCERTAIN' }])
})

test('native diagnostics read own data without invoking error, array or request getters', () => {
  let reads = 0
  const accessor = {
    configurable: true,
    get() {
      reads++
      throw new Error(privateText)
    },
  }
  const message = new OperationError('UNCERTAIN')
  Object.defineProperty(message, 'message', accessor)
  const details = new OperationError('EXECUTION_FAILED')
  Object.defineProperty(details, 'details', accessor)
  const code = new OperationError('UNCERTAIN')
  Object.defineProperty(code, 'code', accessor)
  const helper = new Error()
  Object.defineProperty(helper, 'message', accessor)
  const request = Object.defineProperty({ code: -32603 }, 'method', accessor)
  const toJSON = Object.defineProperty({ method: 'session/new', code: -32603 }, 'toJSON', accessor)
  expect(
    project(
      message,
      details,
      code,
      helper,
      requestError({ nativeRequest: request }),
      requestError({ nativeRequest: toJSON }),
    ).errors,
  ).toEqual([
    { kind: 'operation', code: 'UNCERTAIN' },
    { kind: 'operation', code: 'EXECUTION_FAILED' },
    { kind: 'operation', code: 'other' },
    { kind: 'helper', cause: 'unclassified' },
    { kind: 'operation', code: 'EXECUTION_FAILED' },
    { kind: 'operation', code: 'EXECUTION_FAILED' },
  ])
  const causes = [new Error()]
  Object.defineProperty(causes, '0', accessor)
  expect(nativeConversationErrorDiagnostic({ errors: causes }).errors).toEqual([
    { kind: 'helper', cause: 'unclassified' },
  ])
  const observation = Object.defineProperty({}, 'errors', accessor)
  expect(nativeConversationErrorDiagnostic(observation).errorCount).toBeNull()
  expect(reads).toBe(0)
})

test('native diagnostics tolerate revoked observations and retain codes after optional projection failure', () => {
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  expect(project(requestError(revoked.proxy)).errors).toEqual([
    { kind: 'operation', code: 'EXECUTION_FAILED' },
  ])
  expect(project(revoked.proxy).errors).toEqual([{ kind: 'helper', cause: 'unclassified' }])
  expect(nativeConversationErrorDiagnostic(revoked.proxy).errorCount).toBeNull()
  for (const value of [undefined, null, privateText, {}, { errors: privateText }]) {
    expect(nativeConversationErrorDiagnostic(value)).toEqual({
      errorCount: null,
      errorsTruncated: false,
      errors: [],
    })
  }
})

test('native diagnostics cap projection at eight errors while retaining the observed count', () => {
  const errors = Array.from({ length: 20 }, () => new OperationError('OWNER_CLOSED', privateText))
  Object.defineProperty(errors, '8', {
    get() {
      throw new Error('Beyond projection limit')
    },
  })
  expect(nativeConversationErrorDiagnostic({ errors })).toEqual({
    errorCount: 20,
    errorsTruncated: true,
    errors: Array.from({ length: 8 }, () => ({ kind: 'operation', code: 'OWNER_CLOSED' })),
  })
  expect(project().errorsTruncated).toBeFalse()
  expect(project(...errors.slice(0, 8)).errorsTruncated).toBeFalse()
})
