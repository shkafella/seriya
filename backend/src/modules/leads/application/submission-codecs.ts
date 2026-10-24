import {
  leadRecoveryCapabilitySchema,
  leadSubmissionEnvelopeSchema,
  leadSubmissionPayloadSchema,
  submissionKeySchema,
  type LeadSubmissionEnvelope,
} from '@seriya/contracts'
import { z } from 'zod'

const legacySubmissionEnvelopeV0Schema = z.object({
  idempotencyKey: submissionKeySchema,
  submissionSchemaVersion: z.literal(0),
  receiptToken: leadRecoveryCapabilitySchema,
  payload: leadSubmissionPayloadSchema,
}).strict()

const storedSubmissionHeaderSchema = z.object({
  submissionSchemaVersion: z.number().int().nonnegative(),
}).passthrough()

export type DecodedStoredLeadSubmissionEnvelope = {
  sourceSubmissionSchemaVersion: number
  normalizedEnvelope: LeadSubmissionEnvelope
}

type SubmissionDecoder = (input: unknown) => LeadSubmissionEnvelope

const submissionDecoders = new Map<number, SubmissionDecoder>([
  [0, (input) => {
    const legacy = legacySubmissionEnvelopeV0Schema.parse(input)
    return leadSubmissionEnvelopeSchema.parse({ ...legacy, submissionSchemaVersion: 1 })
  }],
  [1, (input) => leadSubmissionEnvelopeSchema.parse(input)],
])

export const supportedSubmissionSchemaVersions = Object.freeze([...submissionDecoders.keys()])

export function decodeStoredLeadSubmissionEnvelope(input: unknown): DecodedStoredLeadSubmissionEnvelope {
  const { submissionSchemaVersion } = storedSubmissionHeaderSchema.parse(input)
  const decoder = submissionDecoders.get(submissionSchemaVersion)
  if (!decoder) throw new Error(`Unsupported stored lead submission schema version: ${submissionSchemaVersion}`)
  return {
    sourceSubmissionSchemaVersion: submissionSchemaVersion,
    normalizedEnvelope: decoder(input),
  }
}
