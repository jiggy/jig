---
title: Call a Flow from your application
description: Invoke an accepted method from Node, validate its output, and recover without repeating uncertain work.
---

# Call a Flow from your application

Call the greeting from application code and use its message.
The application chooses the input and checks the result.
Jig runs the accepted method and accounts for its execution.

## Before you start

Complete [Run your first Flow](./index.md), including its review and approval.
Use Node.js 22 or newer.
Run every command below from the `hello-jig` directory.
No Agent or additional Flow is required.

Install Jig as an application dependency:

```sh
npm install --save-exact @jigging/jig@alpha
printf '\n.app-state/\n' >> .gitignore
```

Use the same Jig release for review and application execution.
This tutorial selects the application's installed executable explicitly.
Run its review once to establish that selection:

```sh
./node_modules/.bin/jig review --allow-resolution-network
```

Inspect and approve any changed revision.
The network flag has the [same preparation meaning](./index.md#2-review-and-approve) as in the first tutorial.

## 1. Call the accepted method

Create `app.mjs`:

```js
import { mkdir, open } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createAttemptClient } from '@jigging/jig/client'

const project = new URL('.', import.meta.url)
const stateDirectory = new URL('./.app-state/', project)
const client = createAttemptClient({
  executable: fileURLToPath(new URL('./node_modules/.bin/jig', project)),
  cwd: fileURLToPath(project),
})
const target = 'flow:flows/hello'
const inspected = await client.inspect({ target })
if (!inspected || typeof inspected !== 'object' ||
    Array.isArray(inspected) || !('approval' in inspected) ||
    typeof inspected.approval !== 'string') {
  throw new Error('Review and approve the greeting first.')
}

await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
const completed = await client.run({
  expectedApproval: inspected.approval,
  target,
  input: 'Ada',
  files: [],
  constraints: { durationMs: 30_000, resultBytes: 65_536, artifactBytes: 0 },
  outputIntent: { packet: false, receive: [] },
}, {
  persist: async prepared => {
    const record = await open(new URL('greeting-001.json', stateDirectory), 'wx', 0o600)
    try {
      await record.writeFile(JSON.stringify(prepared))
      await record.sync()
    } finally {
      await record.close()
    }
    const directory = await open(stateDirectory, 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  },
})

const retained = await client.result({ ticket: completed.prepared.ticket })
const observation = retained.observation
if (observation.terminal?.status !== 'succeeded' ||
    observation.cleanup !== 'confirmed' || observation.terminal.outcome !== 'done') {
  throw new Error('The greeting did not complete successfully. Inspect its retained result.')
}
if (!retained.output || typeof retained.output !== 'object' ||
    Array.isArray(retained.output) || !('message' in retained.output) ||
    typeof retained.output.message !== 'string') {
  throw new Error('The greeting returned an unexpected message.')
}
console.log(retained.output.message)
```

`inspect` reads the approved target without reviewing live source.
`expectedApproval` prevents the call from silently selecting a different approval.
The request supplies input and bounded execution limits.
This method needs no file attachments or retained artifacts.

The `persist` callback records this task's complete prepared request before submission.
The helper waits for it, submits the unchanged request, and joins execution.
The exclusive file creation prevents another launch when you rerun this script unchanged.
The directory synchronization completes this local file example's persistence step.

In a durable application, persist `Prepared` with the task in one database transaction before submission.
Keep tickets and prepared input private.
They identify retained work and may contain sensitive input.
They do not grant authority.

## 2. Use the result

```sh
node app.mjs
```

After the greeting modification, expect:

```text
Welcome, Ada!
```

The program requires successful execution, confirmed cleanup, the `done` outcome, and a string message.
These checks remain distinct.
A successful execution with a `blocked` outcome would not satisfy this application.
A schema-valid Agent answer could still need domain checks before a consequential action.

`run()` returns execution observations, rather than the method's output.
`result()` reads retained output without executing again.
Retention is bounded, so copy application data into your own store when needed.
See [Application execution](../spec/execution-client.md) for artifact export and exact retention rules.

## 3. Change one application input

Change `input: 'Ada'` to `input: 'Grace'`.
For this new task, change the record filename to `greeting-002.json`.
Then run `node app.mjs` again.
Expect `Welcome, Grace!`.

Changing application input needs no new Flow approval.
Changing the method, its dependencies, or its project configuration needs review.
Choose another task identity only for intentional new work, after resolving the previous task's state.
Deleting a record or choosing a new filename does not make uncertain work safe to repeat.

## Recover after interruption

If the call loses its connection, read the saved task instead of creating another request.
Create `recover.mjs` beside `app.mjs`:

```js
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createAttemptClient } from '@jigging/jig/client'

const project = new URL('.', import.meta.url)
const prepared = JSON.parse(await readFile(
  new URL('./.app-state/greeting-001.json', project), 'utf8',
))
const client = createAttemptClient({
  executable: fileURLToPath(new URL('./node_modules/.bin/jig', project)),
  cwd: fileURLToPath(project),
})
const result = await client.result({ ticket: prepared.ticket })
console.log(JSON.stringify({
  identity: result.observation.identity,
  terminal: result.observation.terminal,
  cleanup: result.observation.cleanup,
  retained: result.observation.retained,
  output: result.output,
}, null, 2))
```

```sh
node recover.mjs
```

Use the filename recorded for the task you are recovering.
This command observes retained state.
It neither resumes a Flow nor submits another attempt.
Missing history does not establish that execution never started.

For explicit cancellation, call `client.cancel({ ticket: prepared.ticket })`.
Acknowledgement confirms the request, rather than complete cleanup.
Read observations until the original owner settles.
Connection loss revokes owned execution but cannot undo remote effects already accepted by a provider.

| Observation | Next action |
| --- | --- |
| Review or approval changed | Inspect the selected target and review its source. Do not silently substitute another approval. |
| The task record already exists | Recover that task before deciding whether to start different work. |
| `AttemptClientError.uncertain` is true | Use the recorded ticket. Do not automatically submit a new request. |
| Cleanup is pending or unresolved | Preserve the task identity and follow [Results and recovery](../build/results.md). |
| Output expired or became unavailable | Preserve the execution observation. Missing bytes do not authorize repeating effects. |

Next, [choose an Agent](../build/agents.md) for interpreted work, then [compose methods](../build/compose.md).
The application boundary stays the same when the accepted method uses code, Agent judgment, or both.
