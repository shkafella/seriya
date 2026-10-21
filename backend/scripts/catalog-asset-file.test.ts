import { describe, expect, test } from 'bun:test'

import {
  assertLightweightPublicAsset,
  MAX_PUBLIC_ASSET_BYTES,
} from './catalog-asset-file'

describe('catalog asset file validation', () => {
  test('accepts a lightweight safe SVG and rejects disguised or active content', () => {
    const encode = (value: string) => new TextEncoder().encode(value)
    const safeSvg = encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10Z"/></svg>')

    expect(() => assertLightweightPublicAsset('/catalog/light.svg', safeSvg)).not.toThrow()
    expect(() => assertLightweightPublicAsset('/catalog/private-model.obj', new Uint8Array(1024)))
      .toThrow('must be a derived SVG')
    expect(() => assertLightweightPublicAsset(
      '/catalog/private-model.svg',
      encode('v 0 0 0\nf 1 1 1\n'),
    )).toThrow('valid SVG markup')
    expect(() => assertLightweightPublicAsset(
      '/catalog/scripted.svg',
      encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    )).toThrow('unsafe active or external content')
    expect(() => assertLightweightPublicAsset(
      '/catalog/external.svg',
      encode('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/private.png"/></svg>'),
    )).toThrow('unsafe active or external content')
    expect(() => assertLightweightPublicAsset(
      '/catalog/full-mesh.svg',
      new Uint8Array(MAX_PUBLIC_ASSET_BYTES + 1),
    )).toThrow('Public catalog asset exceeds')
  })
})
