import { describe, expect, test } from 'bun:test'

import {
  assertLightweightPublicAsset,
  MAX_PUBLIC_ASSET_BYTES,
} from './catalog-asset-file'

describe('catalog asset file validation', () => {
  test('accepts a lightweight asset and rejects a phone-hostile payload', () => {
    expect(() => assertLightweightPublicAsset('/catalog/light.svg', new Uint8Array(1024))).not.toThrow()
    expect(() => assertLightweightPublicAsset(
      '/catalog/full-mesh.svg',
      new Uint8Array(MAX_PUBLIC_ASSET_BYTES + 1),
    )).toThrow('Public catalog asset exceeds')
  })
})
