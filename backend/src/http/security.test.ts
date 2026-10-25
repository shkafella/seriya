import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createRequestSecurity } from './security'

function testApp(maxSize = 64, rateLimitMax = 1) {
  const app = new Hono()
  for (const middleware of createRequestSecurity({
    bodyLimitBytes: maxSize,
    rateLimitMax,
    rateLimitWindowSeconds: 60,
    trustProxy: false,
  }, 'configuration')) app.use('/work', middleware)
  app.post('/work', async (c) => c.json({ body: await c.req.json() }))
  return app
}

describe('public request security', () => {
  test('rejects oversized input before the handler reads JSON', async () => {
    const response = await testApp(8, 10).request('/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'too large' }),
    })
    expect(response.status).toBe(413)
  })

  test('uses an independent bounded bucket and returns retry metadata', async () => {
    const app = testApp()
    const request = () => app.request('/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect((await request()).status).toBe(200)
    const limited = await request()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).not.toBeNull()
  })
})
