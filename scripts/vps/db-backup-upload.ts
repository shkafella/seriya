// Upload a local backup file to S3-compatible storage using Bun's built-in S3
// client (no extra dependencies). Run with cwd=backend so Bun auto-loads
// backend/.env. Exits quietly when storage is not configured.
import { S3Client } from 'bun'
import { basename } from 'node:path'

const filePath = process.argv[2]
if (!filePath) {
  console.error('usage: bun db-backup-upload.ts <file>')
  process.exit(1)
}

const { SPACES_BUCKET, SPACES_ENDPOINT, SPACES_ACCESS_KEY_ID, SPACES_SECRET_ACCESS_KEY } = process.env
if (!SPACES_BUCKET || !SPACES_ENDPOINT || !SPACES_ACCESS_KEY_ID || !SPACES_SECRET_ACCESS_KEY) {
  console.log('S3 storage not configured; skipping the off-server backup copy')
  process.exit(0)
}

const s3 = new S3Client({
  endpoint: SPACES_ENDPOINT,
  // Most S3-compatible providers select the real region from the endpoint.
  region: 'us-east-1',
  bucket: SPACES_BUCKET,
  accessKeyId: SPACES_ACCESS_KEY_ID,
  secretAccessKey: SPACES_SECRET_ACCESS_KEY,
})

const key = `db-backups/${basename(filePath)}`
const local = Bun.file(filePath)

await s3.write(key, local)

const remote = await s3.stat(key)
if (remote.size !== local.size) {
  console.error(`Upload size mismatch: local ${local.size} bytes, remote ${remote.size} bytes`)
  process.exit(1)
}
console.log(`Uploaded ${key} (${remote.size} bytes)`)
