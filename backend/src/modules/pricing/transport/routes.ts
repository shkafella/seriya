import { OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import type { AuthHttpEnv } from '../../auth'
import type { PricingHttpService } from '../application/ports'

export function createPricingRoutes(options: { service: PricingHttpService; requireAuth: MiddlewareHandler<AuthHttpEnv> }) {
  const routes = new OpenAPIHono<AuthHttpEnv>()
  const requireOwner: MiddlewareHandler<AuthHttpEnv> = async (c, next) => {
    await options.service.assertOwner(c.var.user.id)
    await next()
  }
  routes.use('*', options.requireAuth, requireOwner)
  routes.get('/', async (c) => c.json(await options.service.ownerPricing()))
  routes.patch('/draft', async (c) => c.json(await options.service.editDraft(c.var.user.id, await c.req.json())))
  routes.post('/publish', async (c) => c.json(await options.service.publishDraft(c.var.user.id, await c.req.json()), 201))
  return routes
}
