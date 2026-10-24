import { describe, expect, test } from 'bun:test'

import { decodeStoredLeadSubmissionEnvelope, supportedSubmissionSchemaVersions } from './submission-codecs'

const configuration = {
  publicationId: '018f0f89-8a7b-7c6d-8e5f-1234567890ab',
  intentId: 'lead-codec-1',
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

const payload = {
  configuration,
  acceptedQuote: {
    publicationId: configuration.publicationId,
    priceVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ad',
    configurationFingerprint: 'sha256:configuration',
    totalRub: 1000,
  },
  contact: {
    companyName: 'Компания',
    contactName: 'Анна Иванова',
    phone: '+79990000000',
    preferredMessenger: 'telegram',
    messengerContact: '@example_user',
  },
  policyVersionId: '018f0f89-8a7b-7c6d-8e5f-1234567890ae',
  policyStateRevision: 1,
  policyBundleChecksum: 'sha256:policy',
  consentAccepted: true as const,
  honeypot: '',
} as const

const envelope = {
  idempotencyKey: `sk_${'A'.repeat(43)}`,
  receiptToken: `rc_${'B'.repeat(42)}A`,
  payload,
}

describe('stored lead submission codecs', () => {
  test('routes both retained versions and upgrades v0 to the current envelope', () => {
    expect(supportedSubmissionSchemaVersions).toEqual([0, 1])
    expect(decodeStoredLeadSubmissionEnvelope({ ...envelope, submissionSchemaVersion: 0 })).toMatchObject({
      sourceSubmissionSchemaVersion: 0,
      normalizedEnvelope: { submissionSchemaVersion: 1, payload },
    })
    expect(decodeStoredLeadSubmissionEnvelope({ ...envelope, submissionSchemaVersion: 1 })).toMatchObject({
      sourceSubmissionSchemaVersion: 1,
      normalizedEnvelope: { submissionSchemaVersion: 1, payload },
    })
  })

  test('keeps the source version distinct when normalized payloads are otherwise identical', () => {
    const legacy = decodeStoredLeadSubmissionEnvelope({ ...envelope, submissionSchemaVersion: 0 })
    const current = decodeStoredLeadSubmissionEnvelope({ ...envelope, submissionSchemaVersion: 1 })

    expect(legacy.normalizedEnvelope).toEqual(current.normalizedEnvelope)
    expect(legacy.sourceSubmissionSchemaVersion).toBe(0)
    expect(current.sourceSubmissionSchemaVersion).toBe(1)
  })

  test('fails closed for unregistered and malformed stored versions', () => {
    expect(() => decodeStoredLeadSubmissionEnvelope({ ...envelope, submissionSchemaVersion: 2 })).toThrow('Unsupported')
    expect(() => decodeStoredLeadSubmissionEnvelope({
      ...envelope,
      submissionSchemaVersion: 0,
      payload: { ...payload, browserTotal: 1 },
    })).toThrow()
  })
})
