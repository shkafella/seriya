import { configurationQuoteResponseSchema, type ConfigurationQuoteRequest, type ConfigurationQuoteResponse } from '@seriya/contracts'

import { configurationFingerprint } from './configuration-fingerprint'
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
  calculate(snapshot, command) {
    return configurationQuoteResponseSchema.parse({
      ...calculateKitchenQuote(snapshot, command),
      configurationFingerprint: configurationFingerprint(command),
    })
  },
}
