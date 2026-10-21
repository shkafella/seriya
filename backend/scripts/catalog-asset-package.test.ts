import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { stageCatalogAssetPackage } from './catalog-asset-package'

describe('production catalog asset staging', () => {
  test('copies only manifest-declared derived SVG files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seriya-assets-'))
    const source = join(root, 'source')
    const target = join(root, 'target')
    try {
      await Bun.write(join(source, 'family-a.svg'), '<svg/>')
      await Bun.write(join(source, 'private-model.obj'), 'raw geometry')
      const manifestPath = join(source, 'manifest.production.v1.json')
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        assets: [{ familyKey: 'family-a', publicPath: '/catalog/family-a.svg' }],
      }))

      const result = await stageCatalogAssetPackage(manifestPath, source, target)

      expect(result.staged).toBe(1)
      expect(await readdir(target)).toEqual(['family-a.svg', 'manifest.production.v1.json'])
      expect(await readFile(join(target, 'family-a.svg'), 'utf8')).toBe('<svg/>')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects raw files even when a manifest references them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seriya-assets-'))
    try {
      const manifestPath = join(root, 'manifest.production.v1.json')
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        assets: [{ familyKey: 'family-a', publicPath: '/catalog/private-model.obj' }],
      }))

      await expect(stageCatalogAssetPackage(manifestPath, root, join(root, 'target')))
        .rejects.toThrow('Only derived catalog SVG')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
