import type { ConfigurationBootstrap, ConfigurationQuoteResponse, ConfigurationReplacementProposal } from '@seriya/contracts'

export interface ConfigurationHttpService {
  bootstrap(): Promise<ConfigurationBootstrap>
  quote(input: unknown): Promise<ConfigurationQuoteResponse>
  replacementProposal(input: unknown): Promise<ConfigurationReplacementProposal>
}
