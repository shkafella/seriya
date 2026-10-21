import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'

type PackageManifest = {
  schemaVersion: number
  assets: Array<{ familyKey: string; publicPath: string }>
}

export async function stageCatalogAssetPackage(
  manifestPath: string,
  sourceDirectory: string,
  targetDirectory: string,
) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('Unsupported asset manifest')
  }
  const filenames = manifest.assets.map((asset) => {
    const prefix = '/catalog/'
    if (!asset.publicPath.startsWith(prefix)) throw new Error(`Invalid asset path: ${asset.publicPath}`)
    const filename = asset.publicPath.slice(prefix.length)
    if (!filename || basename(filename) !== filename || !filename.endsWith('.svg')) {
      throw new Error(`Only derived catalog SVG filenames may be staged: ${asset.publicPath}`)
    }
    return filename
  })
  if (new Set(filenames).size !== filenames.length) throw new Error('Duplicate asset filenames in manifest')

  const sourceRoot = resolve(sourceDirectory)
  const targetRoot = resolve(targetDirectory)
  await rm(targetRoot, { recursive: true, force: true })
  await mkdir(targetRoot, { recursive: true })
  await copyFile(manifestPath, resolve(targetRoot, 'manifest.production.v1.json'))
  for (const filename of filenames) {
    const source = resolve(sourceRoot, filename)
    if (!source.startsWith(`${sourceRoot}${sep}`)) throw new Error(`Asset path escapes source directory: ${filename}`)
    await copyFile(source, resolve(targetRoot, filename))
  }
  return { staged: filenames.length, filenames }
}

if (import.meta.main) {
  const [manifestPath, sourceDirectory, targetDirectory] = process.argv.slice(2)
  if (!manifestPath || !sourceDirectory || !targetDirectory) {
    throw new Error('Usage: catalog-asset-package.ts <manifest> <source-dir> <target-dir>')
  }
  console.log(JSON.stringify(await stageCatalogAssetPackage(manifestPath, sourceDirectory, targetDirectory)))
}
