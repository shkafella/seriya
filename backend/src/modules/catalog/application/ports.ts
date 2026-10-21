import type {
  OwnerCatalogResponse,
  PrepareCatalogCandidateResponse,
  PublicCatalog,
} from '@seriya/contracts'

export interface CatalogHttpService {
  assertOwner(userId: string): Promise<void>
  ownerCatalog(): Promise<OwnerCatalogResponse>
  editVariant(
    userId: string,
    variantId: string,
    input: unknown,
  ): Promise<OwnerCatalogResponse['variants'][number]>
  prepareCandidate(): Promise<PrepareCatalogCandidateResponse>
  publicCatalog(): Promise<PublicCatalog>
  releaseSmokeCatalog(candidateId: string): Promise<PublicCatalog>
}
