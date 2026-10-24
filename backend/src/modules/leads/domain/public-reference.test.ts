import { describe, expect, test } from 'bun:test'

import { createLeadReference } from './public-reference'

describe('lead public reference', () => {
  test('encodes all 128 supplied random bits as canonical unpadded base64url', () => {
    const reference = createLeadReference(() => Uint8Array.from([
      0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88,
      0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x00,
    ]))

    expect(String(reference)).toBe('_-7dzLuqmYh3ZlVEMyIRAA')
    expect(reference).toHaveLength(22)
    expect(reference).not.toContain('=')
  })

  test('rejects an entropy source with the wrong size', () => {
    expect(() => createLeadReference(() => new Uint8Array(15))).toThrow('exactly 128 bits')
  })
})
