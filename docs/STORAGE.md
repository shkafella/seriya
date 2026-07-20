# Storage And Media

Use this document when a product needs uploads, images, media, generated files, or downloadable assets.

The supported storage path is:

- Any **S3-compatible object storage** for persistent objects (examples: Beget S3, Selectel, Timeweb S3, Yandex Object Storage, AWS S3 — the backend code is provider-agnostic).
- The provider's public/CDN URL for public images, media, and downloads.
- Backend-issued presigned URLs for direct browser/client uploads and private downloads.
- The VPS filesystem only for code and short-lived temporary files.

Do not store user uploads or durable generated assets on the server filesystem. Server disks are small, backups cover the database rather than ad-hoc files, and the server-replacement runbook assumes files live in object storage.

## Intake Before Building File Features

Ask product-level questions before implementation:

- What will users upload: avatars, photos, documents, videos, exports, or something else?
- Are files public, private, shared with selected users, or mixed?
- Which roles can upload, view, replace, and delete files?
- What are the maximum file size and allowed file types?
- Do images need thumbnails, responsive sizes, format conversion, compression, cropping, or moderation?
- How long should files live after the owning record is deleted?
- Should filenames be user-visible, or should the app generate opaque object keys?
- Are uploads required in the first version, or can media be deferred?

Record the answers in the relevant README section when storage affects the active product surface.

## Choosing A Provider

Any S3-compatible provider works; pick by data-location requirements, price, and CDN needs. For products with Russian users and personal data, prefer a provider with RF-located buckets (data-localization law). Create one bucket per environment when practical, for example `<project>-prod`.

## Backend Storage Service

The backend storage layer lives in `backend/src/storage`. It is intentionally a service layer, not a product-specific upload feature.

Use it to:

- generate safe object keys;
- issue presigned PUT URLs for direct uploads;
- issue short-lived presigned GET URLs for private downloads;
- build public CDN URLs for public objects;
- delete objects when the owning product record is deleted.

Required env when storage is active (the `SPACES_*` names are historical; they work with any provider):

```bash
SPACES_REGION=<provider region, e.g. ru1>
SPACES_BUCKET=<project-prod>
SPACES_ENDPOINT=https://<provider S3 endpoint>
SPACES_CDN_BASE_URL=https://<public base URL of the bucket or CDN>
SPACES_ACCESS_KEY_ID=<access-key>
SPACES_SECRET_ACCESS_KEY=<secret-key>
SPACES_UPLOAD_MAX_BYTES=10485760
SPACES_UPLOAD_URL_TTL_SECONDS=900
SPACES_DOWNLOAD_URL_TTL_SECONDS=300
SPACES_PUBLIC_CACHE_CONTROL="public, max-age=31536000, immutable"
```

Leave these variables blank for projects that do not need uploads yet. If any required variable is set, all required variables must be set. **Always set `SPACES_CDN_BASE_URL` explicitly**: without it, public URL construction falls back to a DigitalOcean-Spaces-style hostname that is wrong for other providers.

Provider quirk worth knowing: some S3-compatible providers accept only `us-east-1` as the SDK signing region regardless of the real bucket region. The storage service already signs with `us-east-1` and selects the actual location from `SPACES_ENDPOINT`, so this works out of the box.

## Upload Flow

Default direct-upload flow:

1. Authenticated client asks the backend for an upload URL with intended file metadata.
2. Backend validates role, size, content type, owner record, and target key.
3. Backend returns a presigned PUT URL, browser-settable upload headers, and a `contentLength` value when the upload size is part of the signature.
4. Client uploads directly to object storage.
5. Client calls the app API to confirm the uploaded object key.
6. Backend stores object metadata in PostgreSQL if the product needs ownership, deletion, audit, or private access rules.

Browser upload example:

```ts
if (file.size !== upload.contentLength) {
  throw new Error('File size mismatch')
}

await fetch(upload.uploadUrl, {
  method: upload.method,
  headers: upload.headers,
  body: file,
})
```

The presigned PUT URL validates the requested upload intent before signing. If the product must strictly enforce actual stored file size, content type, or image dimensions, verify the uploaded object before confirming it in the app database. When the backend returns a `contentLength` value, the uploaded body must match that exact byte size even if the browser or HTTP client sets the request header automatically.

For public media, the object should be uploaded with `public-read`, immutable object keys, and long cache headers. For private files, keep objects private and return short-lived presigned GET URLs only after permission checks.

If product records store public media URLs instead of only object keys, shared API contracts must reject non-HTTPS schemes such as `javascript:`, `data:`, and `ftp:`. Prefer storing app-owned object keys and deriving public URLs on the backend.

When browser clients upload directly to object storage, configure the bucket's CORS for the deployed origins and allowed upload headers such as `Content-Type`, `Cache-Control`, and `x-amz-acl`. If a CDN sits in front and CORS changed after files were cached, purge the CDN cache.

## Images And Optimization

Most S3-compatible providers store and deliver images but do not provide first-party dynamic image resizing, compression, cropping, or format transformation.

Default image strategy:

- Store the original upload in object storage.
- When optimized images are required, generate app-owned variants in the backend or a worker (for example with `sharp` at upload-confirm time).
- Store variants under stable keys such as `images/<entity>/<id>/<variant>.webp`.
- Serve public variants through the provider's public/CDN URL.
- Keep the original private if users should not download the raw upload.

Use a library such as `sharp` only when implementing image processing for a product feature. Do not add image-processing dependencies or an image proxy just because uploads exist. If the product needs dynamic transformations by URL, a self-hosted `imgproxy` on the VPS backed by the bucket is the default answer; third-party services such as Cloudinary only when the user explicitly chooses that tradeoff.

## CDN And Caching

- Prefer immutable object keys for public assets so replacing content creates a new URL.
- Use long cache headers for immutable assets.
- Purge CDN caches only for urgent corrections or when mutable URLs cannot be avoided.
- Do not rely on CDN caching for presigned private URLs — signed requests go to the origin.

## Security And Privacy

- Never commit storage access keys or secrets; they live only in `backend/.env` on the server.
- Use limited-access keys scoped to the app bucket when the provider supports it.
- Keep private files private; do not use obscurity-only public URLs for sensitive data.
- Validate MIME type, size, owner, and permissions before issuing upload or download URLs.
- Generate object keys server-side. Do not trust client-provided paths.
- Do not include emails, names, customer IDs, or other sensitive data in object keys.
- Delete or orphan-clean objects when the owning product record is deleted, according to the product retention policy.

## Current Upstream Documentation

- AWS S3 API reference (the common language of all S3-compatible providers): https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html
- AWS SDK for JavaScript v3, S3 client: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
- Presigned URLs concept: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- Your chosen provider's own S3-compatibility and CDN documentation.
