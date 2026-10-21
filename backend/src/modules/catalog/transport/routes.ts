import { OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import type { AuthHttpEnv } from '../../auth'
import type { CatalogHttpService } from '../application/ports'

export function createCatalogRoutes(options: {
  service: CatalogHttpService
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const publicRoutes = new OpenAPIHono<AuthHttpEnv>()
  const ownerRoutes = new OpenAPIHono<AuthHttpEnv>()
  const requireOwner: MiddlewareHandler<AuthHttpEnv> = async (c, next) => {
    await options.service.assertOwner(c.var.user.id)
    await next()
  }

  publicRoutes.get('/', async (c) => c.json(await options.service.publicCatalog()))
  publicRoutes.get('/_release-smoke/:candidateId', async (c) => c.json(await options.service.releaseSmokeCatalog(c.req.param('candidateId'))))
  publicRoutes.get('/families/:slug', async (c) => {
    const catalog = await options.service.publicCatalog()
    const family = catalog.families.find((item) => item.slug === c.req.param('slug'))
    if (!family) return c.json({ error: { code: 'NOT_FOUND', message: 'Catalog family not found' } }, 404)
    return c.json({ publicationId: catalog.publicationId, releaseId: catalog.releaseId, family })
  })

  ownerRoutes.use('*', options.requireAuth, requireOwner)
  ownerRoutes.get('/', async (c) => c.json(await options.service.ownerCatalog()))
  ownerRoutes.patch('/variants/:id', async (c) => c.json(await options.service.editVariant(c.var.user.id, c.req.param('id'), await c.req.json())))
  ownerRoutes.post('/candidate', async (c) => c.json(await options.service.prepareCandidate(), 201))

  return { publicRoutes, ownerRoutes }
}
