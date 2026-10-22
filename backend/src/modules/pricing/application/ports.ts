import type { OwnerPricingResponse } from '@seriya/contracts'

export interface PricingHttpService {
  assertOwner(userId: string): Promise<void>
  ownerPricing(): Promise<OwnerPricingResponse>
  editDraft(userId: string, input: unknown): Promise<OwnerPricingResponse>
  publishDraft(userId: string, input: unknown): Promise<OwnerPricingResponse>
}
