import { describe, expect, test } from 'bun:test'

import type { CatalogSeedModule } from '@seriya/contracts'

import {
  resultingSkuConflictSourceIds,
  sourceTraceChanged,
} from './catalog-import'

const moduleWith = (sourceRecordId: string, sku: string) => ({ sourceRecordId, sku }) as CatalogSeedModule

describe('catalog import reconciliation', () => {
  test('treats source tracing changes as an import update', () => {
    expect(sourceTraceChanged({ sheet: 'Old', row: 10 }, { sheet: 'New', row: 11 })).toBe(true)
    expect(sourceTraceChanged({ sheet: 'Same', row: 10 }, { row: 10, sheet: 'Same' })).toBe(false)
  })

  test('detects a resulting SKU collision with a preserved owner override', () => {
    const conflicts = resultingSkuConflictSourceIds([
      {
        id: 'a', sku: 'A', sourceManaged: true, ownerEditedFields: [],
        sourceRecord: { sourceRecordId: 'catalog-source-0001' },
      },
      {
        id: 'b', sku: 'OWNER-RENAME', sourceManaged: true, ownerEditedFields: ['sku'],
        sourceRecord: { sourceRecordId: 'catalog-source-0002' },
      },
    ], [
      moduleWith('catalog-source-0001', 'OWNER-RENAME'),
      moduleWith('catalog-source-0002', 'B'),
    ])

    expect(conflicts).toEqual(new Set(['catalog-source-0001', 'catalog-source-0002']))
  })

  test('allows a collision-free swap because apply releases imported SKUs first', () => {
    const conflicts = resultingSkuConflictSourceIds([
      {
        id: 'a', sku: 'A', sourceManaged: true, ownerEditedFields: [],
        sourceRecord: { sourceRecordId: 'catalog-source-0001' },
      },
      {
        id: 'b', sku: 'B', sourceManaged: true, ownerEditedFields: [],
        sourceRecord: { sourceRecordId: 'catalog-source-0002' },
      },
    ], [moduleWith('catalog-source-0001', 'B'), moduleWith('catalog-source-0002', 'A')])

    expect(conflicts.size).toBe(0)
  })

  test('allows a new identity to take a SKU released by an existing identity', () => {
    const conflicts = resultingSkuConflictSourceIds([
      {
        id: 'a', sku: 'A', sourceManaged: true, ownerEditedFields: [],
        sourceRecord: { sourceRecordId: 'catalog-source-0001' },
      },
    ], [moduleWith('catalog-source-0001', 'B'), moduleWith('catalog-source-0002', 'A')])

    expect(conflicts.size).toBe(0)
  })
})
