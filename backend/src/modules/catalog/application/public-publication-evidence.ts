import { publicCatalogSchema } from '@seriya/contracts'

import { canonicalJson, sha256 } from './canonical-json'

export type PublicPublicationEvidence = {
  activatedAt: Date | null
  checksum: string
  releaseId: string | null
  snapshot: unknown
  status: 'CANDIDATE' | 'ACTIVE' | 'SUPERSEDED'
}

export function hasConsistentPublicEvidence(publication: PublicPublicationEvidence) {
  if (!publication.activatedAt || !publication.releaseId || publication.status === 'CANDIDATE') return false
  try {
    const snapshot = publicCatalogSchema.parse(publication.snapshot)
    return snapshot.releaseId === publication.releaseId && sha256(canonicalJson(snapshot)) === publication.checksum
  } catch {
    return false
  }
}
