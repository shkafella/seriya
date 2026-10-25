import {
  CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION,
  configuratorDraftSchema,
  migrateConfiguratorDraft,
  type AcceptedConfigurationQuote,
  type ConfigurationQuoteRequest,
  type ConfiguratorDraft,
  type ConfiguratorDraftUiOptions,
} from '@seriya/contracts'

export const CONFIGURATOR_DRAFT_STORAGE_KEY = 'seriya:configurator:draft'

export type ConfiguratorDraftReadResult =
  | { status: 'absent' }
  | { status: 'ready'; draft: ConfiguratorDraft; migrated: boolean }
  | { status: 'unsupported'; version: number }
  | { status: 'corrupt' }

export function serializeConfiguratorDraft(
  command: ConfigurationQuoteRequest,
  acceptedQuote: AcceptedConfigurationQuote | null,
  uiOptions: ConfiguratorDraftUiOptions,
  savedAt = new Date(),
  reconciliationSourceCommand: ConfigurationQuoteRequest | null = null,
) {
  return JSON.stringify(configuratorDraftSchema.parse({
    draftSchemaVersion: CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION,
    savedAt: savedAt.toISOString(),
    command,
    reconciliationSourceCommand,
    uiOptions,
    acceptedQuote,
  }))
}

export function readConfiguratorDraft(raw: string | null): ConfiguratorDraftReadResult {
  if (raw === null) return { status: 'absent' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'corrupt' }
  }

  if (parsed && typeof parsed === 'object') {
    const version = (parsed as { draftSchemaVersion?: unknown }).draftSchemaVersion
    if (typeof version === 'number' && ![0, 1, 2, CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION].includes(version)) {
      return { status: 'unsupported', version }
    }
  }

  try {
    const draft = migrateConfiguratorDraft(parsed)
    return {
      status: 'ready',
      draft,
      migrated: (parsed as { draftSchemaVersion?: unknown }).draftSchemaVersion !== CURRENT_CONFIGURATOR_DRAFT_SCHEMA_VERSION,
    }
  } catch {
    return { status: 'corrupt' }
  }
}
