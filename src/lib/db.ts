import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }
  const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN
  const adapter = new PrismaLibSQL({ url, authToken })
  return new PrismaClient({ adapter })
}

// Defer client construction until the first real database operation. Vercel
// builds preview branches without production-only secrets; eagerly creating
// Prisma at module import time makes otherwise valid builds fail. Runtime DB
// access still fails closed with a clear error if that environment has no DB.
let client: PrismaClient | undefined = globalForPrisma.prisma

function getClient(): PrismaClient {
  if (!client) {
    client = createPrismaClient()
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
  }
  return client
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getClient()
    const value = Reflect.get(instance, property, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
