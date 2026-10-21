export const MAX_PUBLIC_ASSET_BYTES = 64 * 1024

export function assertLightweightPublicAsset(publicPath: string, bytes: Uint8Array) {
  if (bytes.byteLength > MAX_PUBLIC_ASSET_BYTES) {
    throw new Error(
      `Public catalog asset exceeds ${MAX_PUBLIC_ASSET_BYTES} bytes: ${publicPath} (${bytes.byteLength})`,
    )
  }
}
