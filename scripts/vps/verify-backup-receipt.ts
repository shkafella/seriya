import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const [receiptPath, backupDirectory, expectedDatabase] = process.argv.slice(2)
if (!receiptPath || !backupDirectory || !expectedDatabase) {
  throw new Error('Usage: verify-backup-receipt.ts <receipt> <backup-directory> <database>')
}

const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>
const backupId = typeof receipt.backupId === 'string' ? receipt.backupId : ''
const completedAt = typeof receipt.completedAt === 'string' ? Date.parse(receipt.completedAt) : Number.NaN
const integrity = typeof receipt.integrity === 'string' ? receipt.integrity : ''
if (!backupId || basename(backupId) !== backupId || receipt.database !== expectedDatabase) {
  throw new Error('Backup receipt does not identify the target database and a safe backup file')
}
if (!/^sha256:[a-f0-9]{64}$/.test(integrity) || Number.isNaN(completedAt)) {
  throw new Error('Backup receipt has invalid integrity or completion evidence')
}
const ageMs = Date.now() - completedAt
if (ageMs < -5 * 60_000 || ageMs > 24 * 60 * 60_000) throw new Error('Backup receipt is not recent')

const root = resolve(backupDirectory)
const backupPath = resolve(join(root, backupId))
if (!backupPath.startsWith(`${root}/`) && !backupPath.startsWith(`${root}\\`)) throw new Error('Backup path escapes its directory')
await stat(backupPath)
const bytes = await readFile(backupPath)
const actual = createHash('sha256').update(bytes).digest('hex')
if (integrity !== `sha256:${actual}`) throw new Error('Backup checksum does not match its receipt')
console.log(`Verified backup ${backupId} for ${expectedDatabase}`)
