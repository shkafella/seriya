import type {
  LeadSubmissionEnvelope,
  LeadSubmissionSuccess,
  NormalizedLeadContact,
} from '@seriya/contracts'

export type LeadSubmissionUnitOfWorkInput = {
  sourceSubmissionSchemaVersion: number
  normalizedSubmission: LeadSubmissionEnvelope
  normalizedContact: NormalizedLeadContact
  claimToken: string
  now: Date
}

export type LeadSubmissionUnitOfWorkResult =
  | { kind: 'committed'; success: LeadSubmissionSuccess; replay: boolean }
  | { kind: 'pending'; retryAfterSeconds: number }
  | { kind: 'submission_key_conflict' }
  | { kind: 'publication_changed' }
  | { kind: 'policy_changed' }
  | { kind: 'capture_unavailable' }

/**
 * The only Stage 4 port allowed to coordinate lead commit across product contexts.
 * Implementations own the database transaction and expose no Prisma types.
 */
export interface LeadSubmissionUnitOfWork {
  commit(input: LeadSubmissionUnitOfWorkInput): Promise<LeadSubmissionUnitOfWorkResult>
}
