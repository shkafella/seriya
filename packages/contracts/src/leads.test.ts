import { describe, expect, test } from 'bun:test'

import { apiErrorCodeSchema } from './errors'

import {
  configuratorReconciliationRequestSchema,
  configuratorReconciliationResponseSchema,
  leadIntentResponseSchema,
  ownerLeadDetailSchema,
  ownerLeadListItemSchema,
  leadSubmissionEnvelopeSchema,
  leadRecoveryCapabilitySchema,
  leadReferenceSchema,
  leadWorkflowStatusSchema,
  normalizeLeadContact,
  submissionKeySchema,
} from './leads'

const submissionKey = `sk_${'A'.repeat(43)}`
const recoveryCapability = `rc_${'B'.repeat(42)}A`

const configuration = {
  publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ab',
  intentId: 'lead-quote-1',
  wallLengthMm: 2400,
  bodyMaterialId: 'body-white',
  facadeMaterialId: 'facade-oak',
  facadesIncluded: true,
  packagingIncluded: true,
  countertopThicknessMm: 38,
  rows: [{
    row: 'lower',
    modules: [{
      variantId: '018f0f89-8a7b-7c6d-8e5f-1234567890ac',
      startMm: 0,
      cutWidthMm: null,
      withoutFacade: false,
    }],
  }],
  falsePanels: [],
  plinthVariantId: null,
  crownVariantId: null,
} as const

const validEnvelope = {
  idempotencyKey: submissionKey,
  submissionSchemaVersion: 1,
  receiptToken: recoveryCapability,
  payload: {
    configuration,
    acceptedQuote: {
      publicationId: configuration.publicationId,
      priceVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ad',
      configurationFingerprint: 'sha256:configuration',
      totalRub: 125_000,
    },
    contact: {
      companyName: ' Мебель   Сибири ',
      contactName: ' Анна   Иванова ',
      phone: '8 (999) 000-00-00',
      preferredMessenger: 'telegram',
      messengerContact: ' @Visitor_Name ',
    },
    policyVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ae',
    policyStateRevision: 3,
    policyBundleChecksum: 'sha256:policy',
    consentAccepted: true,
    honeypot: '',
  },
} as const

const reconciliationQuote = {
  publicationId: configuration.publicationId,
  priceVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ad',
  intentId: 'reconciled-quote',
  configurationFingerprint: `sha256:${'a'.repeat(64)}`,
  totalRub: 125_000,
  includedVatRub: 20_833.33,
  kitchenHeightMm: 2400,
  rowSpansMm: { lower: 600, wall: 0, mezzanine: 0 },
  freeIntervals: [],
  specification: [],
  warnings: [],
} as const

describe('lead submission contract', () => {
  test('keeps the two 256-bit capabilities branded and non-interchangeable', () => {
    expect(String(submissionKeySchema.parse(submissionKey))).toBe(submissionKey)
    expect(String(leadRecoveryCapabilitySchema.parse(recoveryCapability))).toBe(recoveryCapability)
    expect(() => submissionKeySchema.parse(recoveryCapability)).toThrow()
    expect(() => leadRecoveryCapabilitySchema.parse(submissionKey)).toThrow()
    expect(() => submissionKeySchema.parse(`sk_${'A'.repeat(42)}`)).toThrow()
    expect(() => submissionKeySchema.parse(`sk_${'A'.repeat(43)}=`)).toThrow()
    expect(() => submissionKeySchema.parse(`sk_${'A'.repeat(42)}B`)).toThrow()
    expect(() => leadRecoveryCapabilitySchema.parse(`rc_${'A'.repeat(42)}B`)).toThrow()
  })

  test('accepts exactly one canonical 128-bit public reference', () => {
    expect(String(leadReferenceSchema.parse('AAAAAAAAAAAAAAAAAAAAAA'))).toBe('AAAAAAAAAAAAAAAAAAAAAA')
    expect(leadReferenceSchema.safeParse('AAAAAAAAAAAAAAAAAAAAA').success).toBe(false)
    expect(leadReferenceSchema.safeParse('AAAAAAAAAAAAAAAAAAAAAAA').success).toBe(false)
    expect(leadReferenceSchema.safeParse('AAAAAAAAAAAAAAAAAAAAA=').success).toBe(false)
    expect(leadReferenceSchema.safeParse('AAAAAAAAAAAAAAAAAAAAAB').success).toBe(false)
  })

  test('accepts only the versioned minimal submission envelope', () => {
    expect(leadSubmissionEnvelopeSchema.parse(validEnvelope).submissionSchemaVersion).toBe(1)

    for (const untrusted of [
      { browserTotalRub: 1 },
      { materialRates: { body: 1 } },
      { specification: [{ label: 'forged' }] },
      { consentText: 'forged legal text' },
    ]) {
      expect(() => leadSubmissionEnvelopeSchema.parse({
        ...validEnvelope,
        payload: { ...validEnvelope.payload, ...untrusted },
      })).toThrow()
    }
  })

  test('normalizes supported contact forms deterministically', () => {
    expect(normalizeLeadContact({
      companyName: ' Мебель   Сибири ', contactName: ' Анна   Иванова ', phone: '8 (999) 000-00-00',
      preferredMessenger: 'telegram', messengerContact: ' @Visitor_Name ',
    })).toEqual({
      companyName: 'Мебель Сибири',
      contactName: 'Анна Иванова',
      phone: '+79990000000',
      preferredMessenger: 'telegram',
      messengerContact: 'visitor_name',
    })
    expect(normalizeLeadContact({
      companyName: 'Компания', contactName: 'Иван', phone: '+7 913 000 00 00',
      preferredMessenger: 'whatsapp', messengerContact: '8 (999) 000-00-00',
    })).toMatchObject({
      preferredMessenger: 'whatsapp',
      messengerContact: '+79990000000',
    })
    expect(normalizeLeadContact({
      companyName: 'Компания', contactName: 'Иван', phone: '+7 913 000 00 00',
      preferredMessenger: 'max', messengerContact: '+7 999 000 00 00',
    })).toMatchObject({
      preferredMessenger: 'max',
      messengerContact: '+79990000000',
    })
    expect(normalizeLeadContact({
      companyName: 'Компания', contactName: 'Иван', phone: '+7 913 000 00 00',
      preferredMessenger: 'max', messengerContact: 'ivan2026',
    }).messengerContact).toBe('ivan2026')
    expect(normalizeLeadContact({
      companyName: 'Компания', contactName: 'Иван', phone: '+7 913 000 00 00',
      preferredMessenger: 'max', messengerContact: '@Иван2026',
    }).messengerContact).toBe('иван2026')
  })

  test('requires every deliberately minimal contact field and rejects free text', () => {
    const contact = validEnvelope.payload.contact
    for (const field of ['companyName', 'contactName', 'phone', 'preferredMessenger', 'messengerContact'] as const) {
      const incomplete = { ...contact } as Record<string, unknown>
      delete incomplete[field]
      expect(() => leadSubmissionEnvelopeSchema.parse({
        ...validEnvelope,
        payload: { ...validEnvelope.payload, contact: incomplete },
      })).toThrow()
    }
    expect(() => leadSubmissionEnvelopeSchema.parse({
      ...validEnvelope,
      payload: { ...validEnvelope.payload, contact: { ...contact, comment: 'лишнее поле' } },
    })).toThrow()
  })

  test('keeps the approved three-state owner workflow exact', () => {
    expect(leadWorkflowStatusSchema.options).toEqual(['new', 'in_progress', 'closed'])
    expect(leadWorkflowStatusSchema.safeParse('completed').success).toBe(false)
    expect(leadWorkflowStatusSchema.safeParse('declined').success).toBe(false)
    expect(apiErrorCodeSchema.safeParse('REFERENCE_GENERATION_FAILED').success).toBe(true)
  })

  test('allows an unavailable configuration without a quote only when reconciliation is blocked', () => {
    const base = {
      originalPublicationId: configuration.publicationId,
      currentPublicationId: configuration.publicationId,
      originalQuote: reconciliationQuote,
      currentQuote: null,
      workingCommand: { ...configuration, intentId: reconciliationQuote.intentId },
      currentConfigurationFingerprint: reconciliationQuote.configurationFingerprint,
      requiresAcceptance: false,
    }
    const blockingIssue = {
      code: 'ITEM_UNAVAILABLE',
      path: ['rows', 0, 'modules', 0],
      blocking: true,
      message: 'Модуль больше недоступен',
      target: { kind: 'module', row: 'lower', index: 0 },
      originalSelection: {
        kind: 'variant',
        id: configuration.rows[0].modules[0].variantId,
        publicName: 'Шкаф 600',
        sku: 'LOWER-600',
        row: 'lower',
        widthMm: 600,
        layoutSpanMm: 600,
      },
      replacementOptions: [],
    } as const

    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      issues: [blockingIssue],
    }).success).toBe(true)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      issues: [{ ...blockingIssue, code: 'PRICE_CHANGED', blocking: false }],
    }).success).toBe(false)
    expect(configuratorReconciliationResponseSchema.safeParse({ ...base, issues: [] }).success).toBe(false)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: reconciliationQuote,
      issues: [],
    }).success).toBe(true)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: reconciliationQuote,
      issues: [blockingIssue],
    }).success).toBe(false)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: reconciliationQuote,
      issues: [{ ...blockingIssue, code: 'PRICE_CHANGED', blocking: false }],
      requiresAcceptance: false,
    }).success).toBe(false)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: reconciliationQuote,
      issues: [{ ...blockingIssue, code: 'PRICE_CHANGED', blocking: false }],
      requiresAcceptance: true,
    }).success).toBe(false)

    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: reconciliationQuote,
      issues: [{ ...blockingIssue, blocking: false }],
    }).success).toBe(false)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentPublicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff',
      workingCommand: { ...base.workingCommand, publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff' },
      currentQuote: { ...reconciliationQuote, publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff' },
      issues: [{ code: 'PUBLICATION_CHANGED', blocking: false, path: ['publicationId'], message: 'Публикация обновлена' }],
      requiresAcceptance: true,
    }).success).toBe(true)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentPublicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff',
      workingCommand: { ...base.workingCommand, publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff' },
      currentQuote: { ...reconciliationQuote, publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff' },
      issues: [],
    }).success).toBe(false)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: { ...reconciliationQuote, totalRub: 130_000 },
      issues: [{ code: 'PRICE_CHANGED', blocking: false, path: ['totalRub'], message: 'Цена изменилась' }],
      requiresAcceptance: true,
    }).success).toBe(true)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: { ...reconciliationQuote, totalRub: 130_000 },
      issues: [],
    }).success).toBe(false)
    expect(configuratorReconciliationResponseSchema.safeParse({
      ...base,
      currentQuote: { ...reconciliationQuote, publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ff' },
      issues: [],
    }).success).toBe(false)
  })

  test('requires source and working reconciliation commands to share an intent', () => {
    expect(configuratorReconciliationRequestSchema.safeParse({
      sourceCommand: configuration,
      workingCommand: { ...configuration, intentId: 'another-intent' },
    }).success).toBe(false)
    expect(configuratorReconciliationRequestSchema.safeParse({
      sourceCommand: configuration,
      workingCommand: configuration,
    }).success).toBe(true)
  })

  test('binds every intent state to its exact response shape', () => {
    const intentId = '018f0f89-8a7b-7c6d-8e5f-1234567890ab'
    const expiresAt = '2026-10-24T10:15:00.000Z'
    const reference = 'AAAAAAAAAAAAAAAAAAAAAA'
    const createdAt = '2026-10-24T10:00:00.000Z'

    for (const state of ['open', 'submitting', 'abandonment_pending'] as const) {
      expect(leadIntentResponseSchema.safeParse({
        state, intentId, expiresAt, reference: null, createdAt: null, canRotate: false,
      }).success).toBe(true)
    }
    expect(leadIntentResponseSchema.safeParse({
      state: 'committed', intentId: null, expiresAt: null, reference, createdAt, canRotate: false,
    }).success).toBe(true)
    expect(leadIntentResponseSchema.safeParse({
      state: 'committed', intentId, expiresAt: null, reference, createdAt, canRotate: false,
    }).success).toBe(false)
    for (const state of ['tombstoned', 'abandoned_tombstone'] as const) {
      expect(leadIntentResponseSchema.safeParse({
        state, intentId: null, expiresAt: null, reference: null, createdAt: null, canRotate: true,
      }).success).toBe(true)
      expect(leadIntentResponseSchema.safeParse({
        state, intentId: null, expiresAt: null, reference, createdAt: null, canRotate: true,
      }).success).toBe(false)
    }
  })

  test('keeps owner list contact-free and validates a presentation-safe detail snapshot', () => {
    const listItem = {
      reference: 'AAAAAAAAAAAAAAAAAAAAAA',
      status: 'new',
      revision: 0,
      totalRub: reconciliationQuote.totalRub,
      notificationStatus: 'pending',
      createdAt: '2026-10-24T10:00:00.000Z',
    }
    expect(ownerLeadListItemSchema.safeParse(listItem).success).toBe(true)
    expect(ownerLeadListItemSchema.safeParse({ ...listItem, contactName: 'Анна' }).success).toBe(false)

    const detail = {
      reference: listItem.reference,
      status: listItem.status,
      revision: 0,
      contact: normalizeLeadContact(validEnvelope.payload.contact),
      snapshot: {
        snapshotSchemaVersion: 1,
        command: configuration,
        quote: { ...reconciliationQuote, intentId: configuration.intentId },
        exclusions: ['Доставка не включена'],
        previewDescription: 'Прямая кухня, нижний ряд 600 мм',
      },
      acceptedPolicyVersionId: validEnvelope.payload.policyVersionId,
      acceptedPolicyBundleChecksum: validEnvelope.payload.policyBundleChecksum,
      consentAcceptedAt: listItem.createdAt,
      personalDataExpiresAt: '2027-04-22T10:00:00.000Z',
      notification: { status: 'pending', attemptCount: 0, lastErrorCode: null },
      history: [{ from: null, to: 'new', changedAt: listItem.createdAt }],
      createdAt: listItem.createdAt,
    }
    expect(ownerLeadDetailSchema.safeParse(detail).success).toBe(true)
    expect(ownerLeadDetailSchema.safeParse({
      ...detail,
      snapshot: { ...detail.snapshot, encryptedContact: 'ciphertext' },
    }).success).toBe(false)
  })
})
