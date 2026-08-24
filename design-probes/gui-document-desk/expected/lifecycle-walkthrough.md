# Expected GUI lifecycle

This is a tabletop trace, not runtime output.

1. `jig apply` admits and mounts the index independently of the GUI.
2. The user starts `bun run app/server.ts`. The same-user application opens the
   exact project through a candidate host API and binds localhost itself.
3. Browser submission creates one retained submission key. HTTP retry joins the
   same root Run; it does not create another ingestion.
4. The Run invokes the exact index writer and returns only after its child work
   is terminal or uncertain. The browser observes state through `getRun`.
5. Browser disconnect has no Jig lifetime. Runs continue independently.
6. Server shutdown closes the project client and HTTP listener. It does not
   cancel unrelated Runs or unmount Services.

The application is not reconciled by Jig in this probe. Automatic application
hosting would require a separate concrete lifecycle need; putting it in FLOW
solely to get process supervision would incorrectly grant it portable meaning.
