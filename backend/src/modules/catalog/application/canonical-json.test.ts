import { describe, expect, test } from 'bun:test'

import { canonicalJson, sha256 } from './canonical-json'

describe('canonical catalog JSON', () => {
  test('is independent from object key order', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(canonicalJson({ a: { c: 3, d: 4 }, b: 2 }))
  })

  test('produces a SHA-256 checksum', () => {
    expect(sha256('catalog')).toMatch(/^[a-f0-9]{64}$/)
  })
})
