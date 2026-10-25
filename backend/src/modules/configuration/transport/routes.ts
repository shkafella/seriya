import { OpenAPIHono } from '@hono/zod-openapi'

import type { AuthHttpEnv } from '../../auth'
import type { ConfigurationHttpService } from '../application/ports'

export function createConfigurationRoutes(options: { service: ConfigurationHttpService }) {
  const routes = new OpenAPIHono<AuthHttpEnv>()
  routes.get('/bootstrap', async (c) => c.json(await options.service.bootstrap()))
  routes.post('/quote', async (c) => c.json(await options.service.quote(await c.req.json())))
  routes.post('/replacement-proposal', async (c) => c.json(await options.service.replacementProposal(await c.req.json())))
  routes.post('/reconcile', async (c) => c.json(await options.service.reconcile(await c.req.json())))
  return routes
}
