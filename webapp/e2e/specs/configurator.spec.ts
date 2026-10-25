import type { Route } from '@playwright/test'

import { expect, test } from '../helpers/test'

const configuratorOrigin = `http://127.0.0.1:${process.env.E2E_CONFIGURATOR_PORT}`
const apiOrigin = configuratorOrigin

const ids = {
  publication: '019c0a31-7d03-7000-8000-000000000001',
  lower: '019c0a31-7d03-7000-8000-000000000002',
  wall600: '019c0a31-7d03-7000-8000-000000000003',
  wall500: '019c0a31-7d03-7000-8000-000000000004',
  oldPublication: '019c0a31-7d03-7000-8000-000000000006',
  removedLower: '019c0a31-7d03-7000-8000-000000000007',
  falsePanel: '019c0a31-7d03-7000-8000-000000000008',
  removedFacade: 'facade-removed',
}

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true })

test('keeps the newest phone kitchen quote and supports a safe upper replacement and cut', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route(`${apiOrigin}/api/configurator/bootstrap`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      publicationId: ids.publication, priceVersionId: '019c0a31-7d03-7000-8000-000000000005', catalogRevision: 1,
      materials: [
        { id: 'body-white', name: 'Белый корпус', kind: 'body', isActive: true },
        { id: 'facade-1', name: 'Фасад 1', kind: 'facade', isActive: true },
        { id: 'hdf-white', name: 'ХДФ белый', kind: 'hdf', isActive: true },
      ],
      variants: [
        { id: ids.lower, familyKey: 'lower-shelf', row: 'lower', sku: 'L600', publicName: 'Нижний 600', dimensionsMm: { height: 780, width: 600, depth: 560, layoutSpan: 600 }, cutToWidth: { allowed: true, maxReductionMm: 50, stepMm: 1 }, configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] } },
        { id: ids.wall600, familyKey: 'wall-shelf', row: 'wall', sku: 'W600', publicName: 'Верхний 600', dimensionsMm: { height: 700, width: 600, depth: 320, layoutSpan: 600 }, cutToWidth: { allowed: true, maxReductionMm: 50, stepMm: 1 }, configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] } },
        { id: ids.wall500, familyKey: 'wall-shelf', row: 'wall', sku: 'W500', publicName: 'Верхний 500', dimensionsMm: { height: 700, width: 500, depth: 320, layoutSpan: 500 }, cutToWidth: { allowed: true, maxReductionMm: 50, stepMm: 1 }, configuration: { role: 'ordinary', straightEligible: true, reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [] } },
      ],
    }) })
  })
  await page.route(`${apiOrigin}/api/configurator/replacement-proposal`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      requiresConfirmation: false,
      changes: [{ row: 'wall', index: 0, variantId: ids.wall500, startMm: 0 }],
    }) })
  })

  const quoteRequests: Array<{ intentId: string; rows: Array<{ row: string; modules: Array<{ cutWidthMm: number | null }> }> }> = []
  let delayedQuote: Route | null = null
  await page.route(`${apiOrigin}/api/configurator/quote`, async (route) => {
    const request = route.request().postDataJSON() as typeof quoteRequests[number]
    quoteRequests.push(request)
    if (quoteRequests.length === 1) {
      delayedQuote = route
      return
    }
    await fulfillQuote(route, request.intentId, 23450)
  })

  await page.goto(`${configuratorOrigin}/configurator`)
  await expect(page.getByRole('heading', { name: 'Соберите прямую кухню' })).toBeVisible()
  await page.getByLabel('Длина стены, мм').fill('1800')
  await page.locator('#module-catalog').getByRole('button', { name: /Нижний 600/ }).click()
  await page.waitForTimeout(100)
  expect(pageErrors).toEqual([])
  await expect(page.locator('#kitchen-scene').getByRole('button', { name: /Настроить Нижний 600/ })).toBeVisible()
  await expect.poll(() => quoteRequests.length).toBe(1)

  await page.getByLabel('Фасады нужны').uncheck()
  await expect(page.locator('#quote-total')).toContainText('23')
  await delayedQuote!.fulfill({ contentType: 'application/json', body: JSON.stringify(quoteBody(quoteRequests[0]!.intentId, 12340)) })
  await expect(page.locator('#quote-total')).toContainText('23')

  await page.getByRole('button', { name: 'Средний ряд' }).click()
  await page.getByRole('button', { name: 'Предложить верх' }).click()
  await expect(page.locator('#kitchen-scene').getByRole('button', { name: /Настроить Верхний 600/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Свободно 1200 мм' })).toBeVisible()

  await page.locator('#kitchen-scene').getByRole('button', { name: /Настроить Верхний 600/ }).click()
  await page.getByLabel('Заменять выбранный модуль вместо добавления').check()
  await page.locator('#module-catalog').getByRole('button', { name: /Верхний 500/ }).click()
  await expect(page.locator('#kitchen-scene').getByRole('button', { name: /Настроить Верхний 500/ })).toBeVisible()

  await page.getByRole('button', { name: 'Нижний ряд' }).click()
  await page.locator('#kitchen-scene').getByRole('button', { name: /Настроить Нижний 600/ }).click()
  await page.getByLabel('Подрезать до, мм').fill('550')
  await page.getByRole('button', { name: 'Применить' }).click()
  await expect.poll(() => quoteRequests.some((request) => request.rows.some((row) => row.modules.some((module) => module.cutWidthMm === 550)))).toBe(true)
  await expect(page.locator('#quote-status')).toContainText('Цена рассчитана')
  await expect(page.locator('#kitchen-scene').evaluate((element) => element.scrollWidth <= element.clientWidth)).resolves.toBe(true)
})

test('flushes, restores, and isolates a no-contact draft across tabs', async ({ page, context }) => {
  await context.route(`${apiOrigin}/api/configurator/bootstrap`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(draftBootstrap()) })
  })
  await context.route(`${apiOrigin}/api/configurator/quote`, async (route) => {
    const request = route.request().postDataJSON() as { intentId: string }
    await fulfillQuote(route, request.intentId, 23450)
  })

  await page.goto(`${configuratorOrigin}/configurator`)
  await page.locator('#module-catalog').getByRole('button', { name: /Нижний 600/ }).click()
  await page.getByLabel('Начинать от').selectOption('right')
  await page.getByLabel('Длина стены, мм').fill('2222')
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))

  const storedDraft = await page.evaluate(() => localStorage.getItem('seriya:configurator:draft'))
  expect(storedDraft).not.toBeNull()
  expect(JSON.parse(storedDraft!)).toMatchObject({
    draftSchemaVersion: 3,
    reconciliationSourceCommand: null,
    uiOptions: { startSide: 'right' },
    command: { wallLengthMm: 2222 },
  })
  expect(storedDraft).not.toMatch(/companyName|contactName|phone|messengerContact|consent/i)

  await page.reload()
  await expect(page.locator('#draft-notice-text')).toContainText('Найден сохранённый черновик')
  await expect(page.locator('#draft-notice-text')).toContainText('Чтобы продолжить редактирование')
  await expect(page.locator('#config-app')).toHaveAttribute('inert', '')
  await page.reload()
  await expect(page.locator('#draft-notice-text')).toContainText('Найден сохранённый черновик')
  await expect(page.locator('#config-app')).toHaveAttribute('inert', '')
  await page.getByRole('button', { name: 'Восстановить' }).click()
  await expect(page.locator('#config-app')).not.toHaveAttribute('inert', '')
  await expect(page.getByLabel('Длина стены, мм')).toHaveValue('2222')
  await expect(page.getByLabel('Начинать от')).toHaveValue('right')
  await expect(page.locator('.scene-modules').first()).toHaveClass(/from-right/)

  await page.getByLabel('Начинать от').selectOption('left')
  await page.getByRole('button', { name: 'Отменить последнее изменение' }).click()
  await expect(page.getByLabel('Начинать от')).toHaveValue('right')
  await page.getByRole('button', { name: 'Вернуть отменённое изменение' }).click()
  await expect(page.getByLabel('Начинать от')).toHaveValue('left')

  const otherPage = await context.newPage()
  await otherPage.goto(`${configuratorOrigin}/configurator`)
  const externalSavedAt = await otherPage.evaluate(() => {
    const key = 'seriya:configurator:draft'
    const draft = JSON.parse(localStorage.getItem(key)!)
    draft.savedAt = new Date(Date.now() + 1_000).toISOString()
    draft.uiOptions.startSide = 'right'
    localStorage.setItem(key, JSON.stringify(draft))
    return draft.savedAt as string
  })
  await expect(page.locator('#draft-notice-text')).toContainText('Черновик изменён в другой вкладке')
  await expect(page.getByLabel('Начинать от')).toHaveValue('left')
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  expect(await otherPage.evaluate(() => JSON.parse(localStorage.getItem('seriya:configurator:draft')!))).toMatchObject({
    savedAt: externalSavedAt,
    uiOptions: { startSide: 'right' },
  })
})

test('reconciles a stale phone draft, preserves the removed choice, and requires explicit acceptance', async ({ page, context }) => {
  let reconcileCalls = 0
  let releaseSecondReconcile: (() => void) | null = null
  const secondReconcileGate = new Promise<void>((resolve) => { releaseSecondReconcile = resolve })
  await context.route(`${apiOrigin}/api/configurator/bootstrap`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(draftBootstrap()) })
  })
  await context.route(`${apiOrigin}/api/configurator/quote`, async (route) => {
    const request = route.request().postDataJSON() as { intentId: string }
    await fulfillQuote(route, request.intentId, 130_000)
  })
  await context.route(`${apiOrigin}/api/configurator/reconcile`, async (route) => {
    reconcileCalls += 1
    const request = route.request().postDataJSON() as {
      sourceCommand: Record<string, unknown> & { intentId: string }
      workingCommand: Record<string, unknown> & {
        facadeMaterialId: string | null
        rows: Array<{ modules: Array<{ variantId: string }> }>
        falsePanels: Array<{ variantId: string }>
      }
    }
    if (reconcileCalls === 3) await secondReconcileGate
    const moduleBlocked = request.workingCommand.rows[0]!.modules[0]!.variantId === ids.removedLower
    const materialBlocked = request.workingCommand.facadeMaterialId === ids.removedFacade
    const blocked = moduleBlocked || materialBlocked
    if (!moduleBlocked && request.workingCommand.rows[0]!.modules.length === 1 && request.workingCommand.falsePanels.length > 0) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Фальш-панель больше не находится между модулями' } }),
      })
      return
    }
    const originalQuote = {
      ...quoteBody(request.sourceCommand.intentId, 120_000),
      publicationId: ids.oldPublication,
      priceVersionId: '019c0a31-7d03-7000-8000-000000000008',
    }
    const currentQuote = blocked ? null : quoteBody(request.sourceCommand.intentId, 130_000)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      originalPublicationId: ids.oldPublication,
      currentPublicationId: ids.publication,
      originalQuote,
      currentQuote,
      workingCommand: request.workingCommand,
      currentConfigurationFingerprint: `sha256:${'a'.repeat(64)}`,
      requiresAcceptance: true,
      issues: [
        ...(moduleBlocked ? [{
          code: 'ITEM_UNAVAILABLE',
          blocking: true,
          path: ['rows', 0, 'modules', 0],
          message: 'Модуль «Старый нижний 600» больше недоступен',
          target: { kind: 'module', row: 'lower', index: 0 },
          originalSelection: {
            kind: 'variant', id: ids.removedLower, publicName: 'Старый нижний 600', sku: 'OLD-L600',
            row: 'lower', widthMm: 600, layoutSpanMm: 600,
          },
          replacementOptions: [],
        }] : []),
        ...(materialBlocked ? [{
          code: 'MATERIAL_UNAVAILABLE',
          blocking: true,
          path: ['facadeMaterialId'],
          message: 'Материал «Старый фасад» больше недоступен',
          target: { kind: 'material', field: 'facadeMaterialId' },
          originalSelection: {
            kind: 'material', id: ids.removedFacade, publicName: 'Старый фасад', materialKind: 'facade',
          },
          replacementOptions: [{
            kind: 'material', id: 'facade-1', publicName: 'Фасад 1', materialKind: 'facade',
          }],
        }] : []),
        ...(!blocked ? [{ code: 'PRICE_CHANGED', blocking: false, path: ['totalRub'], message: 'Цена изменилась' }] : []),
        { code: 'PUBLICATION_CHANGED', blocking: false, path: ['publicationId'], message: 'Каталог обновлён' },
      ],
    }) })
  })

  await page.addInitScript(({ oldPublication, removedLower, removedFacade, lower, falsePanel }) => {
    localStorage.setItem('seriya:configurator:draft', JSON.stringify({
      draftSchemaVersion: 2,
      savedAt: '2026-10-24T10:00:00.000Z',
      command: {
        publicationId: oldPublication,
        intentId: 'stale-draft',
        wallLengthMm: 2400,
        bodyMaterialId: 'body-white',
        facadeMaterialId: removedFacade,
        facadesIncluded: true,
        packagingIncluded: false,
        countertopThicknessMm: 38,
        rows: [{ row: 'lower', modules: [
          { variantId: removedLower, startMm: 0, cutWidthMm: null, withoutFacade: false },
          { variantId: lower, startMm: 1200, cutWidthMm: null, withoutFacade: false },
        ] }],
        falsePanels: [{ variantId: falsePanel, row: 'lower', startMm: 600, widthMm: 600, position: 'between' }],
        plinthVariantId: null,
        crownVariantId: null,
      },
      uiOptions: { startSide: 'left' },
      acceptedQuote: null,
    }))
  }, {
    oldPublication: ids.oldPublication,
    removedLower: ids.removedLower,
    removedFacade: ids.removedFacade,
    lower: ids.lower,
    falsePanel: ids.falsePanel,
  })

  await page.goto(`${configuratorOrigin}/configurator`)
  await expect(page.locator('#draft-notice-text')).toContainText('прошлой публикации')
  await page.getByRole('button', { name: 'Восстановить' }).click()
  await expect(page.getByText('Старый нижний 600', { exact: true })).toBeVisible()
  await expect(page.getByText('120 000 ₽')).toBeVisible()
  await expect(page.getByText('после замены')).toBeVisible()
  await page.locator('.reconciliation-issue').filter({ hasText: 'Старый нижний 600' })
    .getByRole('button', { name: 'Удалить позицию' }).click()
  await expect(page.locator('#reconciliation-status')).toContainText('Изменение отменено')
  await expect(page.getByText('Старый нижний 600', { exact: true })).toBeVisible()
  const removeDependentPanel = page.locator('.reconciliation-issue').filter({ hasText: 'Старый нижний 600' })
    .getByRole('button', { name: 'Удалить связанную фальш-панель 1' })
  await removeDependentPanel.click()
  await expect(removeDependentPanel).toBeDisabled()
  releaseSecondReconcile!()
  await page.locator('.reconciliation-issue').filter({ hasText: 'Старый нижний 600' })
    .getByRole('button', { name: 'Удалить позицию' }).click()
  await expect(page.getByText('Старый нижний 600', { exact: true })).toHaveCount(0)
  const materialIssue = page.locator('.reconciliation-issue').filter({ hasText: 'Старый фасад' })
  await expect(materialIssue).toBeVisible()
  await expect(materialIssue.getByRole('button', { name: 'Удалить позицию' })).toHaveCount(0)
  await materialIssue.getByRole('button', { name: 'Заменить' }).click()
  await expect(page.getByText('130 000 ₽')).toBeVisible()
  await page.getByRole('button', { name: 'Принять текущую цену' }).click()
  await expect(page.locator('#config-app')).toBeVisible()
  await expect(page.locator('#kitchen-scene').getByRole('button', { name: /Настроить Нижний 600/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Цена принята' })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('seriya:configurator:draft')!))).toMatchObject({
    draftSchemaVersion: 3,
    reconciliationSourceCommand: null,
    command: { publicationId: ids.publication },
    acceptedQuote: { publicationId: ids.publication, totalRub: 130_000 },
  })
})

test('keeps reconciliation recoverable when the browser cannot persist progress', async ({ page, context }) => {
  let networkCalls = 0
  await context.route(`${apiOrigin}/api/configurator/bootstrap`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(draftBootstrap()) })
  })
  await context.route(`${apiOrigin}/api/configurator/reconcile`, async (route) => {
    networkCalls += 1
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.addInitScript(({ oldPublication, removedLower }) => {
    const originalSetItem = Storage.prototype.setItem
    originalSetItem.call(localStorage, 'seriya:configurator:draft', JSON.stringify({
      draftSchemaVersion: 2,
      savedAt: '2026-10-24T10:00:00.000Z',
      command: {
        publicationId: oldPublication,
        intentId: 'storage-failure',
        wallLengthMm: 2400,
        bodyMaterialId: 'body-white',
        facadeMaterialId: 'facade-1',
        facadesIncluded: true,
        packagingIncluded: false,
        countertopThicknessMm: 38,
        rows: [{ row: 'lower', modules: [{ variantId: removedLower, startMm: 0, cutWidthMm: null, withoutFacade: false }] }],
        falsePanels: [],
        plinthVariantId: null,
        crownVariantId: null,
      },
      uiOptions: { startSide: 'left' },
      acceptedQuote: null,
    }))
    Storage.prototype.setItem = function setItem() {
      throw new DOMException('Storage full', 'QuotaExceededError')
    }
  }, { oldPublication: ids.oldPublication, removedLower: ids.removedLower })

  await page.goto(`${configuratorOrigin}/configurator`)
  await page.getByRole('button', { name: 'Восстановить' }).click()
  await expect(page.locator('#reconciliation-status')).toContainText('Не удалось сохранить прогресс')
  await expect(page.locator('#reconciliation-card')).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить черновик' })).toBeEnabled()
  expect(networkCalls).toBe(0)
})

async function fulfillQuote(route: Route, intentId: string, totalRub: number) {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(quoteBody(intentId, totalRub)) })
}

function quoteBody(intentId: string, totalRub: number) {
  return {
    publicationId: ids.publication, priceVersionId: '019c0a31-7d03-7000-8000-000000000005', intentId,
    configurationFingerprint: `sha256:${'a'.repeat(64)}`,
    totalRub, includedVatRub: 2226.56, kitchenHeightMm: 2568,
    rowSpansMm: { lower: 600, wall: 600, mezzanine: 0 },
    freeIntervals: [{ row: 'wall', startMm: 600, endMm: 1800 }],
    specification: [{ key: 'module', label: 'Нижний 600', quantity: 1, unit: 'шт.', amountRub: totalRub, customerSupplied: false }],
    warnings: [],
  }
}

function draftBootstrap() {
  return {
    publicationId: ids.publication,
    priceVersionId: '019c0a31-7d03-7000-8000-000000000005',
    catalogRevision: 1,
    materials: [
      { id: 'body-white', name: 'Белый корпус', kind: 'body', isActive: true },
      { id: 'facade-1', name: 'Фасад 1', kind: 'facade', isActive: true },
      { id: 'hdf-white', name: 'ХДФ белый', kind: 'hdf', isActive: true },
    ],
    variants: [{
      id: ids.lower,
      familyKey: 'lower-shelf',
      row: 'lower',
      sku: 'L600',
      publicName: 'Нижний 600',
      dimensionsMm: { height: 780, width: 600, depth: 560, layoutSpan: 600 },
      cutToWidth: { allowed: true, maxReductionMm: 50, stepMm: 1 },
      configuration: {
        role: 'ordinary',
        straightEligible: true,
        reservedUpperRows: [],
        falsePanelPositions: [],
        trimLine: null,
        trimLines: [],
      },
    }, {
      id: ids.falsePanel,
      familyKey: 'false-panel',
      row: 'accessory',
      sku: 'FP600',
      publicName: 'Фальш-панель 600',
      dimensionsMm: { height: 780, width: 600, depth: 18, layoutSpan: 600 },
      cutToWidth: { allowed: false, maxReductionMm: null, stepMm: null },
      configuration: {
        role: 'false_panel',
        straightEligible: true,
        reservedUpperRows: [],
        falsePanelPositions: ['start', 'between', 'end'],
        trimLine: null,
        trimLines: [],
      },
    }],
  }
}
