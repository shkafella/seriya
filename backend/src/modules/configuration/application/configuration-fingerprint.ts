import type { ConfigurationQuoteRequest } from '@seriya/contracts'
import { createHash } from 'node:crypto'

export const CONFIGURATION_FINGERPRINT_SCHEMA_VERSION = 1 as const

export function configurationFingerprint(command: ConfigurationQuoteRequest) {
  const rows = new Map(command.rows.map((row) => [row.row, row.modules]))
  const canonical = canonicalJson({
    schemaVersion: CONFIGURATION_FINGERPRINT_SCHEMA_VERSION,
    wallLengthMm: command.wallLengthMm ?? null,
    bodyMaterialId: command.bodyMaterialId,
    facadeMaterialId: command.facadeMaterialId,
    facadesIncluded: command.facadesIncluded,
    packagingIncluded: command.packagingIncluded,
    countertopThicknessMm: command.countertopThicknessMm,
    rows: (['lower', 'wall', 'mezzanine'] as const).flatMap((row) => {
      const modules = rows.get(row)
      return modules ? [{ row, modules }] : []
    }),
    falsePanels: command.falsePanels,
    plinthVariantId: command.plinthVariantId,
    crownVariantId: command.crownVariantId,
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}
