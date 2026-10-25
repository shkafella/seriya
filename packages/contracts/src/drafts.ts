import { z } from 'zod'

import { configurationQuoteRequestSchema } from './configuration'

export const CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION = 3 as const

const isoTimestampSchema = z.string().datetime({ offset: true })

export const acceptedConfigurationQuoteSchema = z.object({
  publicationId: z.string().uuid(),
  priceVersionId: z.string().uuid(),
  configurationFingerprint: z.string().trim().min(1).max(200),
  totalRub: z.number().finite().nonnegative(),
  acceptedAt: isoTimestampSchema,
}).strict()

const legacyConfiguratorDraftV0Schema = z.object({
  draftSchemaVersion: z.literal(0),
  savedAt: isoTimestampSchema,
  command: configurationQuoteRequestSchema,
}).strict()

const legacyConfiguratorDraftV1Schema = z.object({
  draftSchemaVersion: z.literal(1),
  savedAt: isoTimestampSchema,
  command: configurationQuoteRequestSchema,
  acceptedQuote: acceptedConfigurationQuoteSchema.nullable(),
}).strict()

export const configuratorDraftUiOptionsSchema = z.object({
  startSide: z.enum(['left', 'right']),
}).strict()

const legacyConfiguratorDraftV2Schema = z.object({
  draftSchemaVersion: z.literal(2),
  savedAt: isoTimestampSchema,
  command: configurationQuoteRequestSchema,
  uiOptions: configuratorDraftUiOptionsSchema,
  acceptedQuote: acceptedConfigurationQuoteSchema.nullable(),
}).strict()

export const configuratorDraftSchema = z.object({
  draftSchemaVersion: z.literal(CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION),
  savedAt: isoTimestampSchema,
  command: configurationQuoteRequestSchema,
  reconciliationSourceCommand: configurationQuoteRequestSchema.nullable(),
  uiOptions: configuratorDraftUiOptionsSchema,
  acceptedQuote: acceptedConfigurationQuoteSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.acceptedQuote !== null && value.acceptedQuote.publicationId !== value.command.publicationId) {
    context.addIssue({
      code: 'custom',
      path: ['acceptedQuote', 'publicationId'],
      message: 'Accepted quote must belong to the draft publication',
    })
  }
  if (value.reconciliationSourceCommand !== null) {
    if (value.acceptedQuote !== null) {
      context.addIssue({
        code: 'custom',
        path: ['acceptedQuote'],
        message: 'An unfinished reconciliation cannot carry an accepted quote',
      })
    }
    if (value.reconciliationSourceCommand.publicationId === value.command.publicationId) {
      context.addIssue({
        code: 'custom',
        path: ['reconciliationSourceCommand', 'publicationId'],
        message: 'Reconciliation source must belong to an older publication',
      })
    }
    if (value.reconciliationSourceCommand.intentId !== value.command.intentId) {
      context.addIssue({
        code: 'custom',
        path: ['command', 'intentId'],
        message: 'Reconciliation commands must share one intent identifier',
      })
    }
  }
})

export const configuratorDraftMigrationInputSchema = z.discriminatedUnion('draftSchemaVersion', [
  legacyConfiguratorDraftV0Schema,
  legacyConfiguratorDraftV1Schema,
  legacyConfiguratorDraftV2Schema,
  configuratorDraftSchema,
])

export function migrateConfiguratorDraft(input: unknown): ConfiguratorDraft {
  const draft = configuratorDraftMigrationInputSchema.parse(input)
  if (draft.draftSchemaVersion === CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION) {
    return draft
  }

  return configuratorDraftSchema.parse({
    draftSchemaVersion: CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION,
    savedAt: draft.savedAt,
    command: draft.command,
    reconciliationSourceCommand: null,
    uiOptions: { startSide: 'left' },
    acceptedQuote: draft.draftSchemaVersion === 1 || draft.draftSchemaVersion === 2 ? draft.acceptedQuote : null,
    ...(draft.draftSchemaVersion === 2 ? { uiOptions: draft.uiOptions } : {}),
  })
}

export type AcceptedConfigurationQuote = z.infer<typeof acceptedConfigurationQuoteSchema>
export type ConfiguratorDraft = z.infer<typeof configuratorDraftSchema>
export type ConfiguratorDraftUiOptions = z.infer<typeof configuratorDraftUiOptionsSchema>
