import type { Route } from '@playwright/test'

import { expect, test } from '../helpers/test'

const configuratorOrigin = `http://127.0.0.1:${process.env.E2E_CONFIGURATOR_PORT}`
const apiOrigin = configuratorOrigin

const ids = {
  publication: '019c0a31-7d03-7000-8000-000000000001',
  lower: '019c0a31-7d03-7000-8000-000000000002',
  wall600: '019c0a31-7d03-7000-8000-000000000003',
  wall500: '019c0a31-7d03-7000-8000-000000000004',
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
    draftSchemaVersion: 2,
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

async function fulfillQuote(route: Route, intentId: string, totalRub: number) {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(quoteBody(intentId, totalRub)) })
}

function quoteBody(intentId: string, totalRub: number) {
  return {
    publicationId: ids.publication, priceVersionId: '019c0a31-7d03-7000-8000-000000000005', intentId,
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
    }],
  }
}
