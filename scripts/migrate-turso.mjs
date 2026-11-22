// One-time / idempotent schema migration for the remote Turso database.
//
// Background: the Task table was created before provider-refresh columns
// (providerTaskId / providerKeyLabel / providerCheckedAt) were added to the
// Prisma schema. CREATE TABLE IF NOT EXISTS does not alter existing tables,
// so Prisma queries that SELECT those columns fail with
// "no such column: main.Task.providerTaskId" → /api/tasks returns 500.
//
// This script:
//   1. Creates any missing tables (full current schema).
//   2. Adds any missing columns via ALTER TABLE (nullable columns only — safe).
//   3. Creates missing indexes.
// It is safe to run multiple times.
//
// Usage: DATABASE_URL=... DATABASE_AUTH_TOKEN=... node scripts/migrate-turso.mjs
import { createClient } from '@libsql/client'

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('DATABASE_URL and DATABASE_AUTH_TOKEN must be set (e.g. source .env first).')
  process.exit(1)
}

const client = createClient({ url, authToken })

const TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "keyValue" TEXT NOT NULL UNIQUE,
    "label" TEXT NOT NULL DEFAULT 'Unnamed',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "lastErrorAt" TEXT,
    "lastUsedAt" TEXT,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "params" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "usedKeyLabel" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerTaskId" TEXT,
    "providerKeyLabel" TEXT,
    "providerCheckedAt" TEXT,
    "durationMs" INTEGER,
    "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "startedAt" TEXT,
    "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "completedAt" TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS "TaskLog" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "taskId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "internal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
  )`,
]

const INDEX_DDL = [
  `CREATE INDEX IF NOT EXISTS "ApiKey_sortOrder_idx" ON "ApiKey"("sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "ApiKey_status_idx" ON "ApiKey"("status")`,
  `CREATE INDEX IF NOT EXISTS "Task_status_idx" ON "Task"("status")`,
  `CREATE INDEX IF NOT EXISTS "Task_type_idx" ON "Task"("type")`,
  `CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "TaskLog_taskId_idx" ON "TaskLog"("taskId")`,
  `CREATE INDEX IF NOT EXISTS "TaskLog_createdAt_idx" ON "TaskLog"("createdAt")`,
]

// Full expected column list per table (name → ALTER ddl fragment for ADD COLUMN).
const EXPECTED_COLUMNS = {
  ApiKey: {
    id: 'TEXT PRIMARY KEY NOT NULL',
    keyValue: 'TEXT NOT NULL',
    label: "TEXT NOT NULL DEFAULT 'Unnamed'",
    sortOrder: 'INTEGER NOT NULL DEFAULT 0',
    status: "TEXT NOT NULL DEFAULT 'active'",
    lastError: 'TEXT',
    lastErrorAt: 'TEXT',
    lastUsedAt: 'TEXT',
    successCount: 'INTEGER NOT NULL DEFAULT 0',
    failCount: 'INTEGER NOT NULL DEFAULT 0',
    createdAt: 'TEXT',
    updatedAt: 'TEXT',
  },
  Task: {
    id: 'TEXT PRIMARY KEY NOT NULL',
    type: 'TEXT NOT NULL',
    status: "TEXT NOT NULL DEFAULT 'queued'",
    params: 'TEXT NOT NULL',
    result: 'TEXT',
    error: 'TEXT',
    progress: 'INTEGER NOT NULL DEFAULT 0',
    usedKeyLabel: 'TEXT',
    attempts: 'INTEGER NOT NULL DEFAULT 0',
    providerTaskId: 'TEXT',
    providerKeyLabel: 'TEXT',
    providerCheckedAt: 'TEXT',
    durationMs: 'INTEGER',
    createdAt: 'TEXT',
    startedAt: 'TEXT',
    updatedAt: 'TEXT',
    completedAt: 'TEXT',
  },
  TaskLog: {
    id: 'TEXT PRIMARY KEY NOT NULL',
    taskId: 'TEXT NOT NULL',
    level: "TEXT NOT NULL DEFAULT 'info'",
    message: 'TEXT NOT NULL',
    internal: 'INTEGER NOT NULL DEFAULT 0',
    createdAt: 'TEXT',
  },
}

console.log(`Migrating schema on ${url} ...`)

for (const ddl of TABLE_DDL) {
  await client.execute(ddl)
}
console.log('Tables ensured (CREATE TABLE IF NOT EXISTS).')

let altered = 0
for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  const existing = new Set(info.rows.map((r) => r.name))
  for (const [col, ddl] of Object.entries(cols)) {
    if (!existing.has(col)) {
      await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${col}" ${ddl}`)
      console.log(`  ALTER: added ${table}.${col}`)
      altered++
    }
  }
  const missing = Object.keys(cols).filter((c) => !existing.has(c))
  if (missing.length === 0) {
    console.log(`  ${table}: all ${Object.keys(cols).length} columns present`)
  }
}

for (const ddl of INDEX_DDL) {
  await client.execute(ddl)
}
console.log('Indexes ensured.')

// Sanity check: run the exact query shape that /api/tasks uses.
const probe = await client.execute(
  'SELECT "id","type","status","progress","providerTaskId","providerKeyLabel","providerCheckedAt","durationMs" FROM "Task" ORDER BY "createdAt" DESC LIMIT 3',
)
console.log(`Probe query OK — ${probe.rows.length} recent task rows readable.`)
console.log(`Migration complete. Columns added: ${altered}`)
