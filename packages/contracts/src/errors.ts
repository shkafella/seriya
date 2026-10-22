import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'REGISTRATION_CLOSED',
  'OWNER_REQUIRED',
  'CATALOG_NOT_IMPORTED',
  'CATALOG_VARIANT_NOT_FOUND',
  'STALE_CATALOG_EDIT',
  'STALE_PRICE_DRAFT',
  'PRICE_DRAFT_UNCHANGED',
  'PRICING_PUBLISH_BLOCKED',
  'CATALOG_MAINTENANCE',
  'CATALOG_NOT_PUBLISHED',
  'INVALID_CANDIDATE',
  'INVALID_ACTIVATION_STATE',
  'RELEASE_MISMATCH',
  'STALE_CANDIDATE',
  'INVALID_BACKUP_RECEIPT',
  'STALE_BACKUP_RECEIPT',
  'PRODUCTION_ASSETS_INCOMPLETE',
  'CATALOG_ASSETS_INCOMPLETE',
  'INTERNAL_ERROR',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
