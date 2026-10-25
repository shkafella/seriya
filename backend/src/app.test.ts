import { expect, test } from 'bun:test'

import type { DbClient } from './db'
import { loadEnv } from './env'
import { createApp } from './app'

const env = loadEnv({
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/seriya',
  JWT_SECRET: '12345678901234567890123456789012',
})

test('liveness is process-only while readiness checks the database', async () => {
  let databaseAvailable = true
  const prisma = {
    $queryRaw: async () => {
      if (!databaseAvailable) throw new Error('database unavailable')
      return [{ '?column?': 1 }]
    },
  } as unknown as DbClient
  const app = createApp({ env, prisma })

  expect((await app.request('/health/live')).status).toBe(200)
  expect((await app.request('/health/ready')).status).toBe(200)

  databaseAvailable = false

  expect((await app.request('/health/live')).status).toBe(200)
  expect((await app.request('/health/ready')).status).toBe(503)
})

test('readiness exposes the immutable application release id', async () => {
  const releaseEnv = loadEnv({
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/seriya',
    JWT_SECRET: '12345678901234567890123456789012',
    RELEASE_ID: 'candidate-019a0000-0000-7000-8000-000000000001',
  })
  const prisma = { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as DbClient
  const response = await createApp({ env: releaseEnv, prisma }).request('/health/ready')
  expect(await response.json()).toEqual({ status: 'ok', releaseId: releaseEnv.RELEASE_ID })
})

test('CORS preflight allows the standard mutation methods exposed by the client transport', async () => {
  const prisma = { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as DbClient
  const app = createApp({ env, prisma })
  const response = await app.request('/api/future-resource', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'PATCH',
    },
  })

  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-methods')).toContain('PATCH')
})

test('configurator write guards reject unsafe traffic before database work', async () => {
  let databaseCalls = 0
  const guardedEnv = loadEnv({
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/seriya',
    JWT_SECRET: '12345678901234567890123456789012',
    CONFIGURATOR_BODY_LIMIT_BYTES: '8',
    CONFIGURATOR_RECONCILIATION_RATE_LIMIT_MAX: '1',
  })
  const prisma = {
    $queryRaw: async () => {
      databaseCalls += 1
      return [{ '?column?': 1 }]
    },
    $transaction: async () => {
      databaseCalls += 1
      throw new Error('database must not be reached')
    },
  } as unknown as DbClient
  const app = createApp({ env: guardedEnv, prisma })
  const oversized = await app.request('/api/configurator/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'too large' }),
  })

  expect(oversized.status).toBe(413)

  const smallRequest = () => app.request('/api/configurator/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect((await smallRequest()).status).toBe(400)
  expect((await smallRequest()).status).toBe(429)
  expect(databaseCalls).toBe(0)
})
