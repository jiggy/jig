# HTTP log report

A small Bun CLI summarizes newline-delimited JSON HTTP access logs from stdin.
Each record has an integer HTTP `status` (100–599) and a request `path`.
Run `bun src/cli.ts` or `bun test test/project.test.ts` in an appropriate sandbox.

The report counts requests, client errors (400–499), and server errors (500–599).
Empty input produces zero counts. Invalid records exit 2 with `Invalid log`.

Known defects: the parser accepts out-of-range and fractional status codes,
and the reporter counts client errors as server errors. Fix both without
weakening the test suite or changing the CLI output format.
