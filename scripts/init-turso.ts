// scripts/init-turso.ts
// Creates tables directly on Turso via @libsql/client (since prisma db push
// doesn't natively migrate libsql). Prisma Client at runtime uses the libsql adapter.
import { createClient } from '@libsql/client'

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN

if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const client = createClient({ url, authToken })

const statements = [
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
  `CREATE INDEX IF NOT EXISTS "ApiKey_sortOrder_idx" ON "ApiKey"("sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "ApiKey_status_idx" ON "ApiKey"("status")`,

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
    "durationMs" INTEGER,
    "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "startedAt" TEXT,
    "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "completedAt" TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "Task_status_idx" ON "Task"("status")`,
  `CREATE INDEX IF NOT EXISTS "Task_type_idx" ON "Task"("type")`,
  `CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt")`,

  `CREATE TABLE IF NOT EXISTS "TaskLog" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "taskId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "internal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "TaskLog_taskId_idx" ON "TaskLog"("taskId")`,
  `CREATE INDEX IF NOT EXISTS "TaskLog_createdAt_idx" ON "TaskLog"("createdAt")`,

  // Drop old INTEGER-based tables (data loss OK during initial setup).
  `DROP TABLE IF EXISTS "TaskLog_old_int"`,
  `DROP TABLE IF EXISTS "Task_old_int"`,
  `DROP TABLE IF EXISTS "ApiKey_old_int"`,
]

async function main() {
  console.log(`Connecting to ${url} ...`)

  // Detect existing column types and recreate tables if they use INTEGER timestamps.
  const needRecreate = await checkNeedRecreate()
  let savedKeys: { keyValue: string; label: string; sortOrder: number; status: string }[] = []

  if (needRecreate) {
    console.log('Detected INTEGER timestamp columns — recreating tables with TEXT columns...')
    // Preserve existing API keys before dropping.
    try {
      const r = await client.execute(`SELECT keyValue, label, sortOrder, status FROM "ApiKey"`)
      savedKeys = r.rows.map((row) => ({
        keyValue: String((row as { keyValue: string }).keyValue),
        label: String((row as { label: string }).label),
        sortOrder: Number((row as { sortOrder: number }).sortOrder),
        status: String((row as { status: string }).status),
      }))
      console.log(`  Preserved ${savedKeys.length} API keys before recreate.`)
    } catch {
      // no ApiKey table yet
    }

    await client.execute(`DROP TABLE IF EXISTS "TaskLog"`)
    await client.execute(`DROP TABLE IF EXISTS "Task"`)
    await client.execute(`DROP TABLE IF EXISTS "ApiKey"`)
  }

  for (const sql of statements) {
    await client.execute(sql)
    console.log(`OK: ${sql.slice(0, 60).replace(/\n/g, ' ')}...`)
  }

  // Seed: either from preserved keys or from env.
  const existing = await client.execute(`SELECT COUNT(*) AS c FROM "ApiKey"`)
  const count = Number((existing.rows[0] as { c: bigint | number }).c)
  if (count === 0) {
    const seedFrom = needRecreate && savedKeys.length > 0 ? savedKeys : null
    if (seedFrom) {
      for (const k of seedFrom) {
        await client.execute({
          sql: `INSERT INTO "ApiKey" ("id", "keyValue", "label", "sortOrder", "status") VALUES (?, ?, ?, ?, ?)`,
          args: [`seed-${randomSafe()}`, k.keyValue, k.label, k.sortOrder, k.status],
        })
      }
      console.log(`Restored ${seedFrom.length} API keys.`)
    } else if (process.env.KIE_DEFAULT_API_KEY) {
      await client.execute({
        sql: `INSERT INTO "ApiKey" ("id", "keyValue", "label", "sortOrder", "status") VALUES (?, ?, ?, ?, ?)`,
        args: ['seed-key-1', process.env.KIE_DEFAULT_API_KEY, 'Default (seed)', 1, 'active'],
      })
      console.log('Seeded default KIE API key from KIE_DEFAULT_API_KEY')
    }
  }

  const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  console.log('\nTables now present:')
  for (const row of tables.rows) {
    console.log('  -', (row as { name: string }).name)
  }
  console.log('\nDone.')
}

function randomSafe() {
  return Math.random().toString(36).slice(2, 10)
}

async function checkNeedRecreate(): Promise<boolean> {
  try {
    const r = await client.execute(`PRAGMA table_info("Task")`)
    if (r.rows.length === 0) return false
    const cols = r.rows as { name: string; type: string }[]
    const created = cols.find((c) => c.name === 'createdAt')
    if (!created) return false
    // If createdAt is INTEGER, we need to recreate.
    return created.type.toUpperCase() === 'INTEGER'
  } catch {
    return false
  }
}

main().catch((e) => {
  console.error('Failed:', e)
  process.exit(1)
})
