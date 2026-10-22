import { createHash } from 'node:crypto'

import {
  catalogRatesSchema,
  ownerPricingDraftEditSchema,
  ownerPricingPublishSchema,
  ownerPricingResponseSchema,
  ownerPriceVersionSchema,
  pricingRatesSchema,
  type OwnerPricingResponse,
  type PricingRates,
} from '@seriya/contracts'
import type { Prisma } from '../../../generated/prisma/client'

import type { DbClient } from '../../../db'
import { AppError } from '../../../http/errors'

export class PricingService {
  constructor(private readonly db: DbClient) {}

  async assertOwner(userId: string) {
    const owner = await this.db.ownerIdentity.findUnique({ where: { singletonKey: 'owner' } })
    if (!owner || owner.userId !== userId) throw new AppError(403, 'OWNER_REQUIRED', 'Pricing owner access required')
  }

  async ownerPricing(): Promise<OwnerPricingResponse> {
    return this.db.$transaction(async (tx) => {
      const state = await ensurePricingBootstrap(tx)
      const [current, draft, catalog] = await Promise.all([
        tx.priceVersion.findUnique({ where: { id: state.currentPriceVersionId! } }),
        tx.priceDraft.findUnique({ where: { singletonKey: 'pricing' } }),
        tx.catalogState.findUnique({ where: { singletonKey: 'catalog' } }),
      ])
      if (!current || !draft || !catalog) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
      return ownerPricingResponseSchema.parse({
        currentPriceVersion: priceDto(current),
        draft: draftDto(draft),
        catalogActivationState: catalog.activationState,
      })
    })
  }

  async editDraft(userId: string, input: unknown): Promise<OwnerPricingResponse> {
    const command = ownerPricingDraftEditSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const state = await lockPricingState(tx)
      const draft = await lockPricingDraft(tx)
      if (!state.currentPriceVersionId || draft.basePriceVersionId !== state.currentPriceVersionId || draft.revision !== command.revision) {
        throw new AppError(409, 'STALE_PRICE_DRAFT', 'Prices changed; reload the draft and try again')
      }
      const rates = applyDraftChanges(pricingRatesSchema.parse(draft.rates), command)
      const [current, catalog] = await Promise.all([
        tx.priceVersion.findUniqueOrThrow({ where: { id: state.currentPriceVersionId } }),
        tx.catalogState.findUnique({ where: { singletonKey: 'catalog' } }),
      ])
      if (!catalog) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
      const saved = stableJson(rates) === stableJson(pricingRatesSchema.parse(draft.rates))
        ? draft
        : await tx.priceDraft.update({
          where: { id: draft.id },
          data: { rates: rates as Prisma.InputJsonValue, revision: { increment: 1 }, updatedByUserId: userId },
        })
      return ownerPricingResponseSchema.parse({ currentPriceVersion: priceDto(current), draft: draftDto(saved), catalogActivationState: catalog.activationState })
    })
  }

  async publishDraft(userId: string, input: unknown): Promise<OwnerPricingResponse> {
    const command = ownerPricingPublishSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const catalog = await lockCatalogState(tx)
      if (catalog.activationState !== 'IDLE') {
        throw new AppError(409, 'PRICING_PUBLISH_BLOCKED', 'Wait for the catalog release to finish before publishing prices')
      }
      const state = await lockPricingState(tx)
      const draft = await lockPricingDraft(tx)
      if (!state.currentPriceVersionId || draft.basePriceVersionId !== state.currentPriceVersionId || draft.revision !== command.revision) {
        throw new AppError(409, 'STALE_PRICE_DRAFT', 'Prices changed; reload the draft and try again')
      }
      const rates = pricingRatesSchema.parse(draft.rates)
      const current = await tx.priceVersion.findUniqueOrThrow({ where: { id: state.currentPriceVersionId } })
      if (stableJson(rates) === stableJson(pricingRatesSchema.parse(current.rates))) {
        throw new AppError(409, 'PRICE_DRAFT_UNCHANGED', 'Change at least one price before publishing')
      }
      const latest = await tx.priceVersion.findFirst({ orderBy: { version: 'desc' } })
      if (!latest) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
      const checksum = sha256(stableJson(rates))
      const next = await tx.priceVersion.create({
        data: { version: latest.version + 1, currency: 'RUB', rates: rates as Prisma.InputJsonValue, checksum },
      })
      await tx.pricingState.update({ where: { id: state.id }, data: { currentPriceVersionId: next.id } })
      const rebased = await tx.priceDraft.update({
        where: { id: draft.id },
        data: { basePriceVersionId: next.id, rates: rates as Prisma.InputJsonValue, revision: { increment: 1 }, updatedByUserId: userId },
      })
      return ownerPricingResponseSchema.parse({ currentPriceVersion: priceDto(next), draft: draftDto(rebased), catalogActivationState: catalog.activationState })
    }, { maxWait: 10_000, timeout: 30_000 })
  }
}

export async function ensurePricingBootstrap(tx: Prisma.TransactionClient) {
  const ready = await tx.pricingState.findUnique({
    where: { singletonKey: 'pricing' },
    include: { currentPriceVersion: true },
  })
  if (ready?.currentPriceVersion && pricingRatesSchema.safeParse(ready.currentPriceVersion.rates).success) {
    const draft = await tx.priceDraft.findUnique({ where: { singletonKey: 'pricing' } })
    if (draft?.basePriceVersionId === ready.currentPriceVersion.id) return ready
  }
  await tx.pricingState.upsert({
    where: { singletonKey: 'pricing' },
    create: { singletonKey: 'pricing' },
    update: {},
  })
  const locked = await tx.$queryRaw<Array<{ id: string; currentPriceVersionId: string | null }>>`
    SELECT id, current_price_version_id AS "currentPriceVersionId"
    FROM pricing_state WHERE singleton_key = 'pricing' FOR UPDATE
  `
  const existing = locked[0]
  if (!existing) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
  let current = existing.currentPriceVersionId
    ? await tx.priceVersion.findUnique({ where: { id: existing.currentPriceVersionId } })
    : await tx.priceVersion.findFirst({ orderBy: { version: 'desc' } })
  if (!current) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
  let rates = pricingRatesSchema.safeParse(current.rates)
  if (!rates.success) {
    const legacy = catalogRatesSchema.safeParse(current.rates)
    if (!legacy.success) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'The existing price version is invalid')
    const upgradedRates = pricingRatesFromLegacy(legacy.data)
    const latest = await tx.priceVersion.findFirst({ orderBy: { version: 'desc' } })
    if (!latest) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
    current = await tx.priceVersion.create({
      data: {
        version: latest.version + 1,
        currency: 'RUB',
        rates: upgradedRates as Prisma.InputJsonValue,
        checksum: sha256(stableJson(upgradedRates)),
      },
    })
    rates = pricingRatesSchema.safeParse(current.rates)
  }
  if (!rates.success) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'The existing price version is invalid')
  const state = await tx.pricingState.update({
    where: { id: existing.id },
    data: { currentPriceVersionId: current.id },
  })
  const draft = await tx.priceDraft.findUnique({ where: { singletonKey: 'pricing' } })
  if (!draft) {
    await tx.priceDraft.create({ data: { singletonKey: 'pricing', basePriceVersionId: current.id, rates: rates.data as Prisma.InputJsonValue } })
  } else if (draft.basePriceVersionId !== current.id) {
    await tx.priceDraft.update({ where: { id: draft.id }, data: { basePriceVersionId: current.id, rates: rates.data as Prisma.InputJsonValue, revision: { increment: 1 } } })
  }
  return state
}

async function lockCatalogState(tx: Prisma.TransactionClient) {
  const result = await tx.$queryRaw<Array<{ id: string; activationState: 'IDLE' | 'MAINTENANCE' }>>`
    SELECT id, activation_state AS "activationState" FROM catalog_state WHERE singleton_key = 'catalog' FOR UPDATE
  `
  const state = result[0]
  if (!state) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
  return state
}

async function lockPricingState(tx: Prisma.TransactionClient) {
  await ensurePricingBootstrap(tx)
  const result = await tx.$queryRaw<Array<{ id: string; currentPriceVersionId: string | null }>>`
    SELECT id, current_price_version_id AS "currentPriceVersionId" FROM pricing_state WHERE singleton_key = 'pricing' FOR UPDATE
  `
  const state = result[0]
  if (!state) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
  return state
}

function pricingRatesFromLegacy(rates: ReturnType<typeof catalogRatesSchema.parse>): PricingRates {
  const body = [
    ['ldsp-tefi', 'ЛДСП Tefi'], ['ldsp-white', 'ЛДСП белый'], ['lmdf-ultradecor-white', 'ЛМДФ Ultradecor белый'],
    ['lmdf-ultradecor-cashmere', 'ЛМДФ Ultradecor кашемир'], ['lmdf-ultradecor-graphite', 'ЛМДФ Ultradecor серый графит'],
  ].map(([id, name]) => ({ id, name, kind: 'body' as const, rateRubM2: rates.bodyRubM2, isActive: true }))
  const facade = [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `ultradecor-${index + 1}`, name: `Ultradecor цвет ${index + 1}`, kind: 'facade' as const, rateRubM2: rates.facadeRubM2, isActive: true })),
    { id: 'agt-1', name: 'AGT 1', kind: 'facade' as const, rateRubM2: rates.agtRubM2, isActive: true },
  ]
  const hdf = [{ id: 'hdf-white', name: 'ХДФ белый', kind: 'hdf' as const, rateRubM2: rates.hdfRubM2, isActive: true }]
  return {
    ...rates,
    bodyRatesRubM2: body.map((item) => item.rateRubM2),
    facadeRatesRubM2: facade.map((item) => item.rateRubM2),
    hdfRatesRubM2: hdf.map((item) => item.rateRubM2),
    palette: [...body, ...facade, ...hdf],
  }
}

async function lockPricingDraft(tx: Prisma.TransactionClient) {
  const result = await tx.$queryRaw<Array<{ id: string; basePriceVersionId: string; revision: number; rates: unknown; updatedAt: Date }>>`
    SELECT id, base_price_version_id AS "basePriceVersionId", revision, rates, updated_at AS "updatedAt" FROM price_drafts WHERE singleton_key = 'pricing' FOR UPDATE
  `
  const draft = result[0]
  if (!draft) throw new AppError(409, 'CATALOG_NOT_IMPORTED', 'Import the approved catalog first')
  return draft
}

function applyDraftChanges(rates: PricingRates, command: ReturnType<typeof ownerPricingDraftEditSchema.parse>): PricingRates {
  const edits = new Map(command.materialRates?.map((entry) => [entry.id, entry.rateRubM2]) ?? [])
  if (edits.size !== (command.materialRates?.length ?? 0)) throw new AppError(400, 'VALIDATION_ERROR', 'A material rate can appear only once')
  const palette = rates.palette.map((entry) => {
    const rateRubM2 = edits.get(entry.id)
    if (rateRubM2 === undefined) return entry
    return { ...entry, rateRubM2 }
  })
  for (const id of edits.keys()) {
    if (!rates.palette.some((entry) => entry.id === id)) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown material rate')
  }
  return {
    ...rates,
    ...(command.packagingRubM2 === undefined ? {} : { packagingRubM2: command.packagingRubM2 }),
    ...(command.cutToWidthServiceRub === undefined ? {} : { cutToWidthServiceRub: command.cutToWidthServiceRub }),
    palette,
    bodyRatesRubM2: palette.filter((entry) => entry.kind === 'body' && entry.isActive).map((entry) => entry.rateRubM2),
    facadeRatesRubM2: palette.filter((entry) => entry.kind === 'facade' && entry.isActive).map((entry) => entry.rateRubM2),
    hdfRatesRubM2: palette.filter((entry) => entry.kind === 'hdf' && entry.isActive).map((entry) => entry.rateRubM2),
    bodyRubM2: firstRate(palette, 'body'),
    facadeRubM2: firstRate(palette, 'facade'),
    hdfRubM2: firstRate(palette, 'hdf'),
    agtRubM2: palette.find((entry) => entry.id === 'agt-1')?.rateRubM2 ?? rates.agtRubM2,
  }
}

function firstRate(palette: PricingRates['palette'], kind: 'body' | 'facade' | 'hdf') {
  const rate = palette.find((entry) => entry.kind === kind && entry.isActive)?.rateRubM2
  if (rate === undefined) throw new AppError(400, 'VALIDATION_ERROR', `At least one active ${kind} material is required`)
  return rate
}

function priceDto(price: { id: string; version: number; currency: string; rates: unknown; checksum: string; publishedAt: Date }) {
  return ownerPriceVersionSchema.parse({
    id: price.id, version: price.version, currency: price.currency, rates: price.rates,
    checksum: price.checksum, publishedAt: price.publishedAt.toISOString(),
  })
}

function draftDto(draft: { id: string; basePriceVersionId: string; revision: number; rates: unknown; updatedAt: Date }) {
  return { id: draft.id, basePriceVersionId: draft.basePriceVersionId, revision: draft.revision, rates: pricingRatesSchema.parse(draft.rates), updatedAt: draft.updatedAt.toISOString() }
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]))
  }
  return value
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
