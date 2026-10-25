import { z } from 'zod'

import {
  configurationQuoteRequestSchema,
  configurationQuoteResponseSchema,
} from './configuration'

const uuidSchema = z.string().uuid()
const isoTimestampSchema = z.string().datetime({ offset: true })
const checksumSchema = z.string().trim().min(8).max(200)
function isCanonicalUnpaddedBase64Url(value: string, expectedBytes: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
      + '='.repeat((4 - (value.length % 4)) % 4)
    const decoded = atob(padded)
    if (decoded.length !== expectedBytes) return false
    const canonical = btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    return canonical === value
  } catch {
    return false
  }
}

const base64Url256Schema = z.string().length(43).refine(
  (value) => isCanonicalUnpaddedBase64Url(value, 32),
  'Expected canonical unpadded base64url encoding of 256 bits',
)
const base64Url128Schema = z.string().length(22).refine(
  (value) => isCanonicalUnpaddedBase64Url(value, 16),
  'Expected canonical unpadded base64url encoding of 128 bits',
)

function brandedCapabilitySchema(prefix: 'sk_' | 'rc_') {
  return z.string().length(46).superRefine((value, context) => {
    if (!value.startsWith(prefix) || !base64Url256Schema.safeParse(value.slice(prefix.length)).success) {
      context.addIssue({
        code: 'custom',
        message: `Expected canonical ${prefix} 256-bit capability`,
      })
    }
  })
}

export const submissionKeySchema = brandedCapabilitySchema('sk_').brand<'SubmissionKey'>()
export const leadRecoveryCapabilitySchema = brandedCapabilitySchema('rc_').brand<'LeadRecoveryCapability'>()
export const leadReferenceSchema = base64Url128Schema.brand<'LeadReference'>()

export const leadMessengerSchema = z.enum(['telegram', 'whatsapp', 'max'])

const leadContactInputSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(40),
  preferredMessenger: leadMessengerSchema,
  messengerContact: z.string().trim().min(1).max(120),
}).strict()

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeTelegram(value: string) {
  const trimmed = value.trim()
    .replace(/^https?:\/\/(?:www\.)?t\.me\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '')
    .toLowerCase()
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(trimmed)) {
    throw new Error('Invalid Telegram username')
  }
  return trimmed
}

function normalizeRussianPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  const normalized = digits.length === 11 && digits.startsWith('8')
    ? `7${digits.slice(1)}`
    : digits
  if (!/^7\d{10}$/.test(normalized)) {
    throw new Error('Invalid Russian phone number')
  }
  return `+${normalized}`
}

function normalizeMax(value: string) {
  const trimmed = value.trim()
  if (/^[+\d\s().-]+$/.test(trimmed)) return normalizeRussianPhone(trimmed)
  const normalized = trimmed.replace(/^@/, '').toLowerCase()
  if (!/^[a-zа-яё][a-zа-яё0-9_.-]{2,63}$/iu.test(normalized)) {
    throw new Error('Invalid MAX username')
  }
  return normalized
}

export const normalizedLeadContactSchema = z.object({
  companyName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(160),
  phone: z.string().regex(/^\+7\d{10}$/),
  preferredMessenger: leadMessengerSchema,
  messengerContact: z.string().min(1).max(120),
}).strict()

export function normalizeLeadContact(input: unknown): NormalizedLeadContact {
  const contact = leadContactInputSchema.parse(input)
  const messengerContact = contact.preferredMessenger === 'telegram'
    ? normalizeTelegram(contact.messengerContact)
    : contact.preferredMessenger === 'whatsapp'
      ? normalizeRussianPhone(contact.messengerContact)
      : normalizeMax(contact.messengerContact)

  return normalizedLeadContactSchema.parse({
    companyName: normalizeLabel(contact.companyName),
    contactName: normalizeLabel(contact.contactName),
    phone: normalizeRussianPhone(contact.phone),
    preferredMessenger: contact.preferredMessenger,
    messengerContact,
  })
}

export const leadContactSchema = leadContactInputSchema.superRefine((value, context) => {
  try {
    normalizeLeadContact(value)
  } catch {
    context.addIssue({ code: 'custom', message: 'Invalid phone or messenger contact' })
  }
})

export const legalDocumentSchema = z.object({
  text: z.string().min(1).max(100_000),
  checksum: checksumSchema,
}).strict()

export const leadDeliveryModeSchema = z.enum(['telegram_enabled', 'telegram_disabled'])

export const leadPolicyResponseSchema = z.object({
  policyVersionId: uuidSchema,
  policyStateRevision: z.number().int().nonnegative(),
  operatorDisplayName: z.string().min(1).max(300),
  privacyNotice: legalDocumentSchema,
  consent: legalDocumentSchema,
  policyBundleChecksum: checksumSchema,
  retentionDays: z.number().int().positive().max(3650),
  recoveryWindowDays: z.number().int().nonnegative().max(3650),
  deliveryMode: leadDeliveryModeSchema,
  leadCaptureAvailable: z.boolean(),
}).strict()

export const configuratorReconciliationRequestSchema = z.object({
  sourceCommand: configurationQuoteRequestSchema,
  workingCommand: configurationQuoteRequestSchema,
}).strict().superRefine((value, context) => {
  if (value.sourceCommand.intentId !== value.workingCommand.intentId) {
    context.addIssue({
      code: 'custom',
      path: ['workingCommand', 'intentId'],
      message: 'Reconciliation commands must share one intent identifier',
    })
  }
})

export const reconciliationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('module'), row: z.enum(['lower', 'wall', 'mezzanine']), index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('false_panel'), index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('material'), field: z.enum(['bodyMaterialId', 'facadeMaterialId']) }).strict(),
  z.object({ kind: z.literal('trim'), field: z.enum(['plinthVariantId', 'crownVariantId']) }).strict(),
])

export const reconciliationVariantOptionSchema = z.object({
  kind: z.literal('variant'),
  id: uuidSchema,
  publicName: z.string().min(1).max(240),
  sku: z.string().min(1).max(100),
  row: z.enum(['lower', 'wall', 'mezzanine', 'accessory']),
  widthMm: z.number().int().positive(),
  layoutSpanMm: z.number().int().positive().nullable(),
}).strict()

export const reconciliationMaterialOptionSchema = z.object({
  kind: z.literal('material'),
  id: z.string().trim().min(1).max(100),
  publicName: z.string().min(1).max(120),
  materialKind: z.enum(['body', 'facade', 'hdf']),
}).strict()

const reconciliationIssueBaseSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string().min(1).max(300),
})

export const reconciliationIssueSchema = z.discriminatedUnion('code', [
  reconciliationIssueBaseSchema.extend({
    code: z.literal('ITEM_UNAVAILABLE'),
    blocking: z.literal(true),
    target: reconciliationTargetSchema,
    originalSelection: reconciliationVariantOptionSchema,
    replacementOptions: z.array(reconciliationVariantOptionSchema).max(20),
  }).strict(),
  reconciliationIssueBaseSchema.extend({
    code: z.literal('MATERIAL_UNAVAILABLE'),
    blocking: z.literal(true),
    target: reconciliationTargetSchema,
    originalSelection: reconciliationMaterialOptionSchema,
    replacementOptions: z.array(reconciliationMaterialOptionSchema).max(20),
  }).strict(),
  reconciliationIssueBaseSchema.extend({
    code: z.literal('PRICE_CHANGED'),
    blocking: z.literal(false),
  }).strict(),
  reconciliationIssueBaseSchema.extend({
    code: z.literal('PUBLICATION_CHANGED'),
    blocking: z.literal(false),
  }).strict(),
])

export const configuratorReconciliationResponseSchema = z.object({
  originalPublicationId: uuidSchema,
  currentPublicationId: uuidSchema,
  originalQuote: configurationQuoteResponseSchema,
  currentQuote: configurationQuoteResponseSchema.nullable(),
  workingCommand: configurationQuoteRequestSchema,
  issues: z.array(reconciliationIssueSchema),
  currentConfigurationFingerprint: checksumSchema,
  requiresAcceptance: z.boolean(),
}).strict().superRefine((value, context) => {
  const hasBlockingIssue = value.issues.some((issue) => issue.blocking)
  const hasAcceptanceChange = value.issues.some(
    (issue) => !issue.blocking && (issue.code === 'PRICE_CHANGED' || issue.code === 'PUBLICATION_CHANGED'),
  )
  const hasPublicationChangedIssue = value.issues.some((issue) => issue.code === 'PUBLICATION_CHANGED')
  const publicationChanged = value.originalPublicationId !== value.currentPublicationId
  const hasPriceChangedIssue = value.issues.some((issue) => issue.code === 'PRICE_CHANGED')
  const priceChanged = value.currentQuote !== null && (
    value.originalQuote.priceVersionId !== value.currentQuote.priceVersionId
    || value.originalQuote.totalRub !== value.currentQuote.totalRub
  )
  if ((value.currentQuote === null) !== hasBlockingIssue) {
    context.addIssue({
      code: 'custom',
      path: ['currentQuote'],
      message: 'A current quote exists if and only if reconciliation has no blocking issue',
    })
  }
  if (!hasBlockingIssue && value.requiresAcceptance !== hasAcceptanceChange) {
    context.addIssue({
      code: 'custom',
      path: ['requiresAcceptance'],
      message: 'Acceptance is required exactly when a price or publication change is present',
    })
  }
  if (hasPublicationChangedIssue !== publicationChanged) {
    context.addIssue({
      code: 'custom',
      path: ['issues'],
      message: 'PUBLICATION_CHANGED exists if and only if the publication identifier changed',
    })
  }
  if (hasPriceChangedIssue !== priceChanged) {
    context.addIssue({
      code: 'custom',
      path: ['issues'],
      message: 'PRICE_CHANGED exists if and only if the quoted price or price version changed',
    })
  }
  if (value.originalQuote.publicationId !== value.originalPublicationId) {
    context.addIssue({
      code: 'custom',
      path: ['originalQuote', 'publicationId'],
      message: 'The original quote must belong to the original publication',
    })
  }
  if (value.currentQuote !== null && value.currentQuote.publicationId !== value.currentPublicationId) {
    context.addIssue({
      code: 'custom',
      path: ['currentQuote', 'publicationId'],
      message: 'The current quote must belong to the current publication',
    })
  }
  if (value.workingCommand.publicationId !== value.currentPublicationId) {
    context.addIssue({
      code: 'custom',
      path: ['workingCommand', 'publicationId'],
      message: 'The working command must belong to the current publication',
    })
  }
  if (value.currentQuote !== null
    && value.currentConfigurationFingerprint !== value.currentQuote.configurationFingerprint) {
    context.addIssue({
      code: 'custom',
      path: ['currentConfigurationFingerprint'],
      message: 'The reconciliation fingerprint must match the current quote',
    })
  }
  const blockingTargets = value.issues
    .filter((issue) => issue.blocking)
    .map((issue) => JSON.stringify(issue.target))
  if (new Set(blockingTargets).size !== blockingTargets.length) {
    context.addIssue({
      code: 'custom',
      path: ['issues'],
      message: 'A reconciliation target may have only one blocking issue',
    })
  }
})

export const leadIntentRequestSchema = z.object({
  idempotencyKey: submissionKeySchema,
  receiptToken: leadRecoveryCapabilitySchema,
}).strict()

export const leadIntentStateSchema = z.enum([
  'open',
  'submitting',
  'abandonment_pending',
  'committed',
  'tombstoned',
  'abandoned_tombstone',
])

const activeLeadIntentResponseFields = {
  intentId: uuidSchema,
  expiresAt: isoTimestampSchema,
  reference: z.null(),
  createdAt: z.null(),
  canRotate: z.literal(false),
}

export const leadIntentResponseSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('open'), ...activeLeadIntentResponseFields }).strict(),
  z.object({ state: z.literal('submitting'), ...activeLeadIntentResponseFields }).strict(),
  z.object({ state: z.literal('abandonment_pending'), ...activeLeadIntentResponseFields }).strict(),
  z.object({
    state: z.literal('committed'),
    intentId: z.null(),
    expiresAt: z.null(),
    reference: leadReferenceSchema,
    createdAt: isoTimestampSchema,
    canRotate: z.literal(false),
  }).strict(),
  z.object({
    state: z.literal('tombstoned'),
    intentId: z.null(),
    expiresAt: z.null(),
    reference: z.null(),
    createdAt: z.null(),
    canRotate: z.literal(true),
  }).strict(),
  z.object({
    state: z.literal('abandoned_tombstone'),
    intentId: z.null(),
    expiresAt: z.null(),
    reference: z.null(),
    createdAt: z.null(),
    canRotate: z.literal(true),
  }).strict(),
])

export const leadIntentAbandonRequestSchema = z.object({
  idempotencyKey: submissionKeySchema,
  receiptToken: leadRecoveryCapabilitySchema,
}).strict()

export const acceptedLeadQuoteSchema = z.object({
  publicationId: uuidSchema,
  priceVersionId: uuidSchema,
  configurationFingerprint: checksumSchema,
  totalRub: z.number().finite().nonnegative(),
}).strict()

export const leadSubmissionPayloadSchema = z.object({
  configuration: configurationQuoteRequestSchema,
  acceptedQuote: acceptedLeadQuoteSchema,
  contact: leadContactSchema,
  policyVersionId: uuidSchema,
  policyStateRevision: z.number().int().nonnegative(),
  policyBundleChecksum: checksumSchema,
  consentAccepted: z.literal(true),
  honeypot: z.string().max(0),
}).strict()

export const leadSubmissionEnvelopeSchema = z.object({
  idempotencyKey: submissionKeySchema,
  submissionSchemaVersion: z.literal(1),
  receiptToken: leadRecoveryCapabilitySchema,
  payload: leadSubmissionPayloadSchema,
}).strict()

export const leadSubmissionSuccessSchema = z.object({
  reference: leadReferenceSchema,
  createdAt: isoTimestampSchema,
}).strict()

export const leadReceiptRequestSchema = z.object({
  receiptToken: leadRecoveryCapabilitySchema,
}).strict()

export const leadReceiptResponseSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending'), retryAfterSeconds: z.number().int().positive() }).strict(),
  z.object({ state: z.literal('committed'), reference: leadReferenceSchema, createdAt: isoTimestampSchema }).strict(),
  z.object({ state: z.literal('expired'), canRotate: z.literal(true) }).strict(),
  z.object({ state: z.literal('erased'), canRotate: z.literal(true) }).strict(),
  z.object({ state: z.literal('abandoned'), canRotate: z.literal(true) }).strict(),
  z.object({ state: z.literal('not_found'), canRotate: z.literal(true) }).strict(),
])

export const leadWorkflowStatusSchema = z.enum(['new', 'in_progress', 'closed'])
export const leadNotificationStatusSchema = z.enum([
  'pending',
  'leased',
  'dispatch_started',
  'sent',
  'failed',
  'delivery_uncertain',
  'suppressed',
  'cancelled_policy',
])

export const ownerLeadListRequestSchema = z.object({
  cursor: z.string().max(300).nullable().optional(),
  status: leadWorkflowStatusSchema.nullable().optional(),
  limit: z.number().int().min(1).max(100).default(30),
}).strict()

export const ownerLeadListItemSchema = z.object({
  reference: leadReferenceSchema,
  status: leadWorkflowStatusSchema,
  revision: z.number().int().nonnegative(),
  totalRub: z.number().finite().nonnegative(),
  notificationStatus: leadNotificationStatusSchema,
  createdAt: isoTimestampSchema,
}).strict()

export const ownerLeadListResponseSchema = z.object({
  items: z.array(ownerLeadListItemSchema),
  nextCursor: z.string().max(300).nullable(),
}).strict()

const leadReferenceRequestSchema = z.object({
  reference: leadReferenceSchema,
}).strict()

export const ownerLeadDetailRequestSchema = leadReferenceRequestSchema
export const ownerLeadStatusRequestSchema = leadReferenceRequestSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  status: leadWorkflowStatusSchema,
}).strict()
export const ownerLeadNotificationRetryRequestSchema = leadReferenceRequestSchema.extend({
  acknowledgePossibleDuplicate: z.boolean().default(false),
}).strict()
export const ownerLeadEraseRequestSchema = leadReferenceRequestSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  erasureRequestId: uuidSchema,
}).strict()

export const ownerLeadSnapshotSchema = z.object({
  snapshotSchemaVersion: z.literal(1),
  command: configurationQuoteRequestSchema,
  quote: configurationQuoteResponseSchema,
  exclusions: z.array(z.string().min(1).max(300)).max(100),
  previewDescription: z.string().min(1).max(2_000),
}).strict().superRefine((value, context) => {
  if (value.command.publicationId !== value.quote.publicationId) {
    context.addIssue({
      code: 'custom',
      path: ['quote', 'publicationId'],
      message: 'Snapshot command and quote must belong to the same publication',
    })
  }
  if (value.command.intentId !== value.quote.intentId) {
    context.addIssue({
      code: 'custom',
      path: ['quote', 'intentId'],
      message: 'Snapshot command and quote must belong to the same calculation intent',
    })
  }
})

export const ownerLeadDetailSchema = z.object({
  reference: leadReferenceSchema,
  status: leadWorkflowStatusSchema,
  revision: z.number().int().nonnegative(),
  contact: normalizedLeadContactSchema,
  snapshot: ownerLeadSnapshotSchema,
  acceptedPolicyVersionId: uuidSchema,
  acceptedPolicyBundleChecksum: checksumSchema,
  consentAcceptedAt: isoTimestampSchema,
  personalDataExpiresAt: isoTimestampSchema,
  notification: z.object({
    status: leadNotificationStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    lastErrorCode: z.string().max(120).nullable(),
  }).strict(),
  history: z.array(z.object({
    from: leadWorkflowStatusSchema.nullable(),
    to: leadWorkflowStatusSchema,
    changedAt: isoTimestampSchema,
  }).strict()),
  createdAt: isoTimestampSchema,
}).strict()

export type SubmissionKey = z.infer<typeof submissionKeySchema>
export type LeadRecoveryCapability = z.infer<typeof leadRecoveryCapabilitySchema>
export type LeadReference = z.infer<typeof leadReferenceSchema>
export type NormalizedLeadContact = z.infer<typeof normalizedLeadContactSchema>
export type LeadSubmissionEnvelope = z.infer<typeof leadSubmissionEnvelopeSchema>
export type LeadSubmissionSuccess = z.infer<typeof leadSubmissionSuccessSchema>
export type LeadPolicyResponse = z.infer<typeof leadPolicyResponseSchema>
export type ConfiguratorReconciliationRequest = z.infer<typeof configuratorReconciliationRequestSchema>
export type ConfiguratorReconciliationResponse = z.infer<typeof configuratorReconciliationResponseSchema>
export type ReconciliationIssue = z.infer<typeof reconciliationIssueSchema>
export type OwnerLeadListItem = z.infer<typeof ownerLeadListItemSchema>
export type OwnerLeadSnapshot = z.infer<typeof ownerLeadSnapshotSchema>
export type OwnerLeadDetail = z.infer<typeof ownerLeadDetailSchema>
