import 'dotenv/config'

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

import type { Prisma } from '../src/generated/prisma/client'
import { createPrisma } from '../src/db'
import { assertLightweightPublicAsset } from './catalog-asset-file'

type ManifestAsset = {
  familyKey: string
  publicPath: string
  sourceChecksum?: string | null
  derivedChecksum: string
  status: 'DEVELOPMENT' | 'APPROVED' | 'REJECTED'
  rightsApproved: boolean
  productionApproved: boolean
  provenance: Record<string, unknown>
  geometry: Record<string, unknown>
  masks: Record<string, unknown>
}

const command = process.argv[2]
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const manifestPath = resolve(process.argv[3] ?? '../website/public/catalog/manifest.v1.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { schemaVersion: number; assets: ManifestAsset[] }
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) throw new Error('Unsupported asset manifest')

const db = createPrisma(databaseUrl)
try {
  await validateManifestFiles(manifest.assets, manifestPath)
  if (command === 'sync') {
    const result = await db.$transaction(async (tx) => {
      const families = await tx.catalogFamily.findMany({ where: { isActive: true }, select: { id: true, key: true, assetId: true } })
      const byKey = new Map(manifest.assets.map((asset) => [asset.familyKey, asset]))
      const missing = families.filter((family) => !byKey.has(family.key)).map((family) => family.key)
      const unknown = manifest.assets.filter((asset) => !families.some((family) => family.key === asset.familyKey)).map((asset) => asset.familyKey)
      if (missing.length || unknown.length) throw new Error(`Asset manifest coverage mismatch; missing=${missing.join(',')}; unknown=${unknown.join(',')}`)

      let changed = false
      for (const family of families) {
        const item = byKey.get(family.key)!
        const key = `family:${family.key}`
        const current = await tx.catalogAsset.findUnique({ where: { key } })
        if (current?.productionApproved && !item.productionApproved) {
          throw new Error(`Refusing to replace approved production asset for ${family.key} with a development asset`)
        }
        const assetData = {
          publicPath: item.publicPath,
          sourceChecksum: item.sourceChecksum ?? null,
          derivedChecksum: item.derivedChecksum,
          status: item.status,
          rightsApproved: item.rightsApproved,
          productionApproved: item.productionApproved,
          provenance: item.provenance as Prisma.InputJsonValue,
          geometry: item.geometry as Prisma.InputJsonValue,
          masks: item.masks as Prisma.InputJsonValue,
        }
        if (!current || assetChanged(current, assetData) || family.assetId !== current.id) changed = true
        const asset = await tx.catalogAsset.upsert({
          where: { key },
          create: { key, ...assetData },
          update: assetData,
        })
        if (family.assetId !== asset.id) await tx.catalogFamily.update({ where: { id: family.id }, data: { assetId: asset.id } })
      }
      if (changed) await tx.catalogState.update({ where: { singletonKey: 'catalog' }, data: { revision: { increment: 1 } } })
      return { synced: families.length, catalogRevisionChanged: changed }
    })
    console.log(JSON.stringify(result))
  } else if (command === 'check-production') {
    if (!manifest.assets.every(isProductionReady)) throw new Error('Manifest contains assets that are not fully production-approved')
    const families = await db.catalogFamily.findMany({
      where: { isActive: true, variants: { some: { isActive: true, isComplete: true } } },
      include: { asset: true },
    })
    const byKey = new Map(manifest.assets.map((asset) => [asset.familyKey, asset]))
    const missing = families.filter((family) => {
      const declared = byKey.get(family.key)
      const stored = family.asset
      return !declared || !stored || !isProductionReady(declared)
        || stored.status !== 'APPROVED' || !stored.rightsApproved || !stored.productionApproved
        || stored.publicPath !== declared.publicPath || stored.derivedChecksum !== declared.derivedChecksum
    }).map((family) => family.key)
    console.log(JSON.stringify({ productionReady: missing.length === 0, missingFamilies: missing }))
    if (missing.length > 0) process.exitCode = 2
  } else throw new Error('Usage: catalog-assets.ts sync|check-production [manifest]')
} finally {
  await db.$disconnect()
}

async function validateManifestFiles(assets: ManifestAsset[], path: string) {
  const duplicateKeys = assets.filter((asset, index) => assets.findIndex((other) => other.familyKey === asset.familyKey) !== index)
  if (duplicateKeys.length) throw new Error(`Duplicate asset family keys: ${duplicateKeys.map((asset) => asset.familyKey).join(',')}`)
  const publicRoot = resolve(dirname(path), '..')
  for (const asset of assets) {
    if (!asset.publicPath.startsWith('/catalog/') || !/^[a-f0-9]{64}$/.test(asset.derivedChecksum)) throw new Error(`Invalid asset declaration for ${asset.familyKey}`)
    if (!asset.provenance || Object.keys(asset.provenance).length === 0) throw new Error(`Missing provenance for ${asset.familyKey}`)
    const filePath = resolve(publicRoot, asset.publicPath.slice(1))
    if (!filePath.startsWith(`${publicRoot}${sep}`)) throw new Error(`Asset path escapes public root: ${asset.publicPath}`)
    await stat(filePath)
    const bytes = await readFile(filePath)
    assertLightweightPublicAsset(asset.publicPath, bytes)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== asset.derivedChecksum) throw new Error(`Asset checksum mismatch for ${asset.familyKey}`)
  }
}

function isProductionReady(asset: ManifestAsset) {
  return asset.status === 'APPROVED' && asset.rightsApproved && asset.productionApproved
    && Boolean(asset.sourceChecksum?.match(/^[a-f0-9]{64}$/)) && Object.keys(asset.provenance).length > 0
}

function assetChanged(current: {
  publicPath: string; sourceChecksum: string | null; derivedChecksum: string; status: string;
  rightsApproved: boolean; productionApproved: boolean; provenance: unknown; geometry: unknown; masks: unknown;
}, next: {
  publicPath: string; sourceChecksum: string | null; derivedChecksum: string; status: string;
  rightsApproved: boolean; productionApproved: boolean; provenance: Prisma.InputJsonValue;
  geometry: Prisma.InputJsonValue; masks: Prisma.InputJsonValue;
}) {
  return current.publicPath !== next.publicPath || current.sourceChecksum !== next.sourceChecksum
    || current.derivedChecksum !== next.derivedChecksum || current.status !== next.status
    || current.rightsApproved !== next.rightsApproved || current.productionApproved !== next.productionApproved
    || JSON.stringify(current.provenance) !== JSON.stringify(next.provenance)
    || JSON.stringify(current.geometry) !== JSON.stringify(next.geometry)
    || JSON.stringify(current.masks) !== JSON.stringify(next.masks)
}
