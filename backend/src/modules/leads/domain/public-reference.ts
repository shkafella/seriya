import { randomBytes } from 'node:crypto'

import { leadReferenceSchema, type LeadReference } from '@seriya/contracts'

export type ReferenceEntropySource = () => Uint8Array

export function createLeadReference(
  entropy: ReferenceEntropySource = () => randomBytes(16),
): LeadReference {
  const bytes = entropy()
  if (bytes.byteLength !== 16) throw new Error('Lead reference entropy source must return exactly 128 bits')
  return leadReferenceSchema.parse(Buffer.from(bytes).toString('base64url'))
}
