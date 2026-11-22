// Dump the ACTUAL column schemas of the remote Turso tables.
import { createClient } from '@libsql/client'

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('DATABASE_URL / DATABASE_AUTH_TOKEN must be set')
  process.exit(1)
}
const client = createClient({ url, authToken })

for (const table of ['ApiKey', 'Task', 'TaskLog']) {
  const r = await client.execute(`PRAGMA table_info("${table}")`)
  console.log(`\n== ${table} ==`)
  for (const row of r.rows) {
    const c = row
    console.log(`  ${c.name}: ${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''}`)
  }
}
