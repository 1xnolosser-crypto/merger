// Verify the Turso database from the session summary is reachable and has schema.
import { createClient } from '@libsql/client'

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('DATABASE_URL and DATABASE_AUTH_TOKEN must be set (e.g. in .env).')
  process.exit(1)
}

const client = createClient({ url, authToken })

console.log('Connecting to', url, '...')
try {
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  )
  const names = tables.rows.map((r) => r.name)
  console.log('Tables:', names.length ? names.join(', ') : '(none — DB is empty)')
  for (const t of ['ApiKey', 'Task', 'TaskLog']) {
    if (!names.includes(t)) {
      console.log(`  ${t}: missing`)
      continue
    }
    try {
      const c = await client.execute(`SELECT COUNT(*) AS c FROM "${t}"`)
      const n = c.rows[0].c
      console.log(`  ${t}: ${typeof n === 'bigint' ? n.toString() : n} rows`)
    } catch (e) {
      console.log(`  ${t}: count error — ${e.message}`)
    }
  }
  if (names.includes('ApiKey')) {
    const keys = await client.execute(
      'SELECT label, status, sortOrder FROM "ApiKey" ORDER BY sortOrder',
    )
    console.log('  ApiKey rows:', keys.rows.map((r) => ({ label: r.label, status: r.status, sortOrder: r.sortOrder })))
  }
  console.log('RESULT: TURSO_REACHABLE')
} catch (e) {
  console.error('CONNECT FAILED:', e.message)
  console.error('RESULT: TURSO_UNREACHABLE')
  process.exit(1)
}
