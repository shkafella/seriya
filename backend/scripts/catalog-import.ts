import 'dotenv/config'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { catalogImportPreviewSchema } from '@seriya/contracts'
import { createPrisma } from '../src/db'
import { applyCatalogImport, loadCatalogSeed, previewCatalogImport } from '../src/modules/catalog'

const command = process.argv[2]
const backendRoot = resolve(import.meta.dir, '..')
const repoRoot = resolve(backendRoot, '..')
const sourcePath = resolve(repoRoot, process.argv[3] ?? 'catalog/seed/catalog.v1.json')
const previewPath = resolve(repoRoot, process.argv[4] ?? '.scratch/catalog-import.preview.json')
const sourceMapPath = resolve(repoRoot, process.env.CATALOG_SOURCE_MAP_PATH ?? 'catalog/source-map.v1.json')
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (!['preview', 'apply'].includes(command ?? '')) throw new Error('Usage: catalog-import.ts preview|apply [seed] [preview]')

const db = createPrisma(databaseUrl)
try {
  const loaded = loadCatalogSeed(
    await readFile(sourcePath, 'utf8'),
    sourcePath,
    await readFile(sourceMapPath, 'utf8'),
  )
  if (command === 'preview') {
    const preview = await previewCatalogImport(db, loaded)
    await mkdir(dirname(previewPath), { recursive: true })
    await writeFile(previewPath, `${JSON.stringify(preview, null, 2)}\n`, { flag: 'w' })
    console.log(JSON.stringify({ previewPath, valid: preview.valid, counts: preview.counts }))
    if (!preview.valid) process.exitCode = 2
  } else {
    const preview = catalogImportPreviewSchema.parse(JSON.parse(await readFile(previewPath, 'utf8')))
    const result = await applyCatalogImport(db, loaded, preview)
    console.log(JSON.stringify({ resultingRevision: result.resultingRevision, counts: result.counts }))
  }
} finally {
  await db.$disconnect()
}
