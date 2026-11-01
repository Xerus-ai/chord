# NOT THE DEPLOYABLE MIGRATIONS — DO NOT APPLY THESE

This directory is drizzle-kit's generated snapshot chain (`pnpm db:generate`
output). It is **stale** and **explicitly not on the deploy path**.

The deployable migration set is `server/src/db/migrations/` — hand-written
SQL, applied by `pnpm run migrate` per `DEPLOYMENT.md §4`, and enforced by
`server/src/db/migration-coverage.test.ts` (every table AND every column in
`schema.ts` must be created by a file THERE, not here).

If you are adding a table or column: write the SQL in
`server/src/db/migrations/` and keep the coverage test green. Applying or
extending the files in this directory does nothing for any deployed
environment.
