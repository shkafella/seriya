import type { ConfigurationQuoteRequest, ConfigurationQuoteResponse } from '@seriya/contracts'

import {
  calculateKitchenQuote,
  type PublishedKitchenSnapshot,
} from '../domain/kitchen-quote'

export interface ConfigurationSnapshotCalculator {
  calculate(
    snapshot: PublishedKitchenSnapshot,
    command: ConfigurationQuoteRequest,
  ): ConfigurationQuoteResponse
}

export const configurationSnapshotCalculator: ConfigurationSnapshotCalculator = {
  calculate: calculateKitchenQuote,
}
