import type {
  AcceptedConfigurationQuote,
  ConfigurationQuoteRequest,
  ConfigurationQuoteResponse,
  ConfiguratorReconciliationRequest,
  ConfiguratorReconciliationResponse,
} from '@seriya/contracts'

export type ReconciliationClient = (
  request: ConfiguratorReconciliationRequest,
) => Promise<ConfiguratorReconciliationResponse>

export type PreSubmissionReconciliation =
  | {
      status: 'ready'
      command: ConfigurationQuoteRequest
      quote: ConfigurationQuoteResponse
    }
  | {
      status: 'reconciliation_required'
      reason: 'not_accepted' | 'blocked' | 'quote_changed' | 'publication_changed'
      reconciliation: ConfiguratorReconciliationResponse | null
    }

export function acceptedQuoteFromResponse(
  quote: ConfigurationQuoteResponse,
  acceptedAt = new Date(),
): AcceptedConfigurationQuote {
  return {
    publicationId: quote.publicationId,
    priceVersionId: quote.priceVersionId,
    configurationFingerprint: quote.configurationFingerprint,
    totalRub: quote.totalRub,
    acceptedAt: acceptedAt.toISOString(),
  }
}

export function acceptanceMatchesQuote(
  accepted: AcceptedConfigurationQuote | null,
  quote: ConfigurationQuoteResponse,
) {
  return accepted !== null
    && accepted.publicationId === quote.publicationId
    && accepted.priceVersionId === quote.priceVersionId
    && accepted.configurationFingerprint === quote.configurationFingerprint
    && accepted.totalRub === quote.totalRub
}

export async function reconcileBeforeSubmission(
  command: ConfigurationQuoteRequest,
  accepted: AcceptedConfigurationQuote | null,
  reconcile: ReconciliationClient,
): Promise<PreSubmissionReconciliation> {
  if (accepted === null) {
    return { status: 'reconciliation_required', reason: 'not_accepted', reconciliation: null }
  }

  let reconciliation: ConfiguratorReconciliationResponse
  try {
    reconciliation = await reconcile({ sourceCommand: command, workingCommand: command })
  } catch (error) {
    if (reconciliationErrorCode(error) === 'PUBLICATION_CHANGED') {
      return { status: 'reconciliation_required', reason: 'publication_changed', reconciliation: null }
    }
    throw error
  }
  if (reconciliation.currentQuote === null) {
    return { status: 'reconciliation_required', reason: 'blocked', reconciliation }
  }
  if (!acceptanceMatchesQuote(accepted, reconciliation.currentQuote)) {
    return { status: 'reconciliation_required', reason: 'quote_changed', reconciliation }
  }
  return {
    status: 'ready',
    command: reconciliation.workingCommand,
    quote: reconciliation.currentQuote,
  }
}

function reconciliationErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  if ('code' in error && typeof error.code === 'string') return error.code
  if ('error' in error && error.error && typeof error.error === 'object'
    && 'code' in error.error && typeof error.error.code === 'string') return error.error.code
  return null
}
