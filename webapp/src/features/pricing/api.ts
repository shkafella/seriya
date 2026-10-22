import {
  ownerPricingResponseSchema,
  type OwnerPricingDraftEdit,
  type OwnerPricingResponse,
} from '@seriya/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export class PricingApi {
  private readonly transport: AuthenticatedTransport

  constructor(transport: AuthenticatedTransport) {
    this.transport = transport
  }

  get(): Promise<OwnerPricingResponse> {
    return this.transport.request('/api/owner/pricing', ownerPricingResponseSchema)
  }

  editDraft(input: OwnerPricingDraftEdit): Promise<OwnerPricingResponse> {
    return this.transport.request('/api/owner/pricing/draft', ownerPricingResponseSchema, { method: 'PATCH', body: input })
  }

  publish(revision: number): Promise<OwnerPricingResponse> {
    return this.transport.request('/api/owner/pricing/publish', ownerPricingResponseSchema, { method: 'POST', body: { revision } })
  }
}
