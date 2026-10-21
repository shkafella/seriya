import {
  ownerCatalogResponseSchema,
  ownerCatalogVariantSchema,
  prepareCatalogCandidateResponseSchema,
  type OwnerCatalogResponse,
  type OwnerCatalogVariantEdit,
  type PrepareCatalogCandidateResponse,
} from '@seriya/contracts'
import type { AuthenticatedTransport } from '@/platform/api'

export class CatalogApi {
  private readonly transport: AuthenticatedTransport

  constructor(transport: AuthenticatedTransport) {
    this.transport = transport
  }

  list(): Promise<OwnerCatalogResponse> {
    return this.transport.request('/api/owner/catalog', ownerCatalogResponseSchema)
  }

  edit(id: string, input: OwnerCatalogVariantEdit) {
    return this.transport.request(`/api/owner/catalog/variants/${id}`, ownerCatalogVariantSchema, {
      method: 'PATCH', body: input,
    })
  }

  prepare(): Promise<PrepareCatalogCandidateResponse> {
    return this.transport.request('/api/owner/catalog/candidate', prepareCatalogCandidateResponseSchema, { method: 'POST' })
  }
}
