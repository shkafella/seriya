import { describe, expect, test } from 'bun:test'

import {
  scopeValueToPrincipal,
  valueVisibleToPrincipal,
} from '../src/features/catalog/catalog-session'

describe('owner catalog session scope', () => {
  test('never exposes a previous owner catalog to another authenticated account', () => {
    const ownerCatalog = scopeValueToPrincipal('owner-user', { unpublishedPrice: 42_000 })

    expect(valueVisibleToPrincipal(ownerCatalog, 'owner-user')).toEqual({ unpublishedPrice: 42_000 })
    expect(valueVisibleToPrincipal(ownerCatalog, 'ordinary-user')).toBeNull()
    expect(valueVisibleToPrincipal(ownerCatalog, null)).toBeNull()
  })
})
