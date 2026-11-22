import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  // Support the documented Turso names as well as the app's DATABASE_URL.
  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN

  // Next.js collects route data during build and imports API route modules.
  // This local placeholder is ONLY for build-time module initialization; it is
  // never used as a runtime database. Actual requests still require Turso env vars.
  const buildPhase = process.env.NEXT_PHASE === 'phase-production-build'
  if (!url && !buildPhase) {
    throw new Error('DATABASE_URL (or TURSO_DATABASE_URL) is not set')
  }

  const adapter = new PrismaLibSQL({
    url: url || 'file:./vercel-build-placeholder.db',
    authToken,
  })
  return new PrismaClient({ adapter })
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
