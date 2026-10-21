import type { OwnerCatalogResponse } from '@seriya/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { CatalogApi } from './api'
import {
  scopeValueToPrincipal,
  valueVisibleToPrincipal,
  type PrincipalScopedValue,
} from './catalog-session'

type Variant = OwnerCatalogResponse['variants'][number]

export function CatalogPage() {
  const auth = useAuth()
  const principalId = auth.user?.id ?? null
  const api = useMemo(() => new CatalogApi(auth.transport), [auth.transport])
  const [scopedCatalog, setScopedCatalog] = useState<PrincipalScopedValue<OwnerCatalogResponse> | null>(null)
  const catalog = valueVisibleToPrincipal(scopedCatalog, principalId)
  const [scopedMessage, setScopedMessage] = useState<PrincipalScopedValue<string> | null>(null)
  const message = valueVisibleToPrincipal(scopedMessage, principalId) ?? ''
  const setMessage = useCallback((next: string) => {
    setScopedMessage(principalId ? scopeValueToPrincipal(principalId, next) : null)
  }, [principalId])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')

  const load = async () => {
    const requestedPrincipalId = principalId
    setScopedCatalog(null)
    setSelectedId(null)
    setMessage('')
    setState('loading')
    if (!requestedPrincipalId) return
    try {
      const next = await api.list()
      setScopedCatalog(scopeValueToPrincipal(requestedPrincipalId, next))
      setSelectedId((current) => current && next.variants.some((item) => item.id === current) ? current : next.variants[0]?.id ?? null)
      setState('ready')
    } catch (error) {
      setScopedCatalog(null)
      setSelectedId(null)
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить каталог')
      setState('error')
    }
  }

  useEffect(() => {
    const requestedPrincipalId = principalId
    let active = true
    if (!requestedPrincipalId) return () => { active = false }
    void api.list().then((next) => {
      if (!active) return
      setScopedCatalog(scopeValueToPrincipal(requestedPrincipalId, next))
      setSelectedId((current) => current && next.variants.some((item) => item.id === current) ? current : next.variants[0]?.id ?? null)
      setState('ready')
    }).catch((error: unknown) => {
      if (!active) return
      setScopedCatalog(null)
      setSelectedId(null)
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить каталог')
      setState('error')
    })
    return () => { active = false }
  }, [api, principalId, setMessage])

  if (!auth.user) return <CatalogShell><Typography>Сначала войдите в аккаунт владельца.</Typography></CatalogShell>
  if (!catalog && !message) return <CatalogShell><div className="flex items-center gap-3"><Spinner /><Typography as="span">Загружаем каталог…</Typography></div></CatalogShell>
  if (!catalog) return <CatalogShell><Typography role="alert" tone="destructive">{message}</Typography><Button onClick={() => void load()}>Повторить</Button></CatalogShell>

  const normalized = query.trim().toLowerCase()
  const filtered = catalog.variants.filter((item) => !normalized || `${item.sku} ${item.publicName}`.toLowerCase().includes(normalized))
  const selected = catalog.variants.find((item) => item.id === selectedId) ?? null

  const save = async (variant: Variant, changes: Record<string, unknown>) => {
    setState('saving'); setMessage('')
    try {
      await api.edit(variant.id, { revision: variant.revision, changes })
      await load()
      setMessage('Сохранено. Изменения ещё не опубликованы.')
    } catch (error) {
      setState('ready')
      setMessage(error instanceof Error ? `Не сохранено: ${error.message}. Обновите данные и повторите.` : 'Не удалось сохранить')
    }
  }

  const prepare = async () => {
    setState('saving'); setMessage('')
    try {
      const candidate = await api.prepare()
      await load()
      setMessage(`Кандидат ${candidate.candidateId.slice(0, 8)} подготовлен и ожидает выпуска.`)
    } catch (error) {
      setState('ready'); setMessage(error instanceof Error ? error.message : 'Не удалось подготовить выпуск')
    }
  }

  return (
    <CatalogShell>
      <div className="grid gap-3 sm:flex sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant={catalog.publicationStatus === 'UNPREPARED' ? 'destructive' : 'secondary'}>{publicationStatusLabel(catalog.publicationStatus)}</Badge>
            <Badge variant="outline">Редакция {catalog.catalogRevision}</Badge>
          </div>
          <Typography variant="h1">Каталог модулей</Typography>
          <Typography tone="muted">225 вариантов. Цены материалов на этом этапе доступны только для просмотра.</Typography>
        </div>
        <Button disabled={state === 'saving' || !catalog.hasUnpreparedChanges} onClick={() => void prepare()}>Подготовить выпуск</Button>
      </div>

      {message && <Typography as="div" variant="bodySm" role="status" className="rounded-lg border bg-muted/40 p-3">{message}</Typography>}

      <Card>
        <CardHeader><CardTitle>Стартовые ставки</CardTitle><CardDescription>Корпус {catalog.priceVersion.rates.bodyRubM2} ₽/м² · фасад {catalog.priceVersion.rates.facadeRubM2} ₽/м² · AGT {catalog.priceVersion.rates.agtRubM2} ₽/м² · ХДФ {catalog.priceVersion.rates.hdfRubM2} ₽/м²</CardDescription></CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,.75fr)_minmax(0,1.25fr)]">
        <Card className="min-w-0">
          <CardHeader><CardTitle>Варианты</CardTitle><Input aria-label="Поиск по каталогу" placeholder="Артикул или название" value={query} onChange={(event) => setQuery(event.target.value)} /></CardHeader>
          <CardContent className="grid max-h-[65vh] gap-2 overflow-auto">
            {filtered.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`min-h-14 rounded-lg border p-3 text-left ${selectedId === item.id ? 'border-primary bg-primary/5' : 'bg-background'}`}><Typography as="strong" variant="bodySmMedium" className="block">{item.publicName}</Typography><Typography as="span" variant="bodyXs" tone="muted">{item.sku} · {item.dimensionsMm.width} мм</Typography></button>)}
          </CardContent>
        </Card>
        {selected && <VariantEditor key={`${selected.id}:${selected.revision}`} variant={selected} assets={catalog.assets} disabled={state === 'saving'} save={save} />}
      </div>
    </CatalogShell>
  )
}

function VariantEditor({ variant, assets, disabled, save }: { variant: Variant; assets: OwnerCatalogResponse['assets']; disabled: boolean; save: (variant: Variant, changes: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(variant.publicName)
  const [sku, setSku] = useState(variant.sku)
  const [width, setWidth] = useState(String(variant.dimensionsMm.width))
  const [height, setHeight] = useState(String(variant.dimensionsMm.height))
  const [depth, setDepth] = useState(String(variant.dimensionsMm.depth))
  const [layoutSpan, setLayoutSpan] = useState(variant.dimensionsMm.layoutSpan ? String(variant.dimensionsMm.layoutSpan) : '')
  const [assetId, setAssetId] = useState(variant.assetId ?? '__family__')
  const [active, setActive] = useState(variant.isActive)
  const [cutPolicy, setCutPolicy] = useState<'allowed' | 'forbidden'>(variant.cutPolicy)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const next = {
      publicName: name,
      sku,
      widthMm: Number(width),
      heightMm: Number(height),
      depthMm: Number(depth),
      layoutSpanMm: layoutSpan.trim() === '' ? null : Number(layoutSpan),
      assetId: assetId === '__family__' ? null : assetId,
      isActive: active,
      cutPolicy,
    }
    const original = {
      publicName: variant.publicName,
      sku: variant.sku,
      widthMm: variant.dimensionsMm.width,
      heightMm: variant.dimensionsMm.height,
      depthMm: variant.dimensionsMm.depth,
      layoutSpanMm: variant.dimensionsMm.layoutSpan ?? null,
      assetId: variant.assetId,
      isActive: variant.isActive,
      cutPolicy: variant.cutPolicy,
    }
    const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== original[key as keyof typeof original]))
    if (Object.keys(changes).length > 0) void save(variant, changes)
  }

  return <Card className="min-w-0"><CardHeader><CardTitle>Редактирование</CardTitle><CardDescription>{variant.sourceManaged ? 'Импортируемый вариант' : 'Создан владельцем'} · версия {variant.revision}</CardDescription></CardHeader><CardContent><form className="grid gap-4" onSubmit={submit}>
    <Field label="Публичное название"><Input value={name} onChange={(event) => setName(event.target.value)} required /></Field>
    <Field label="Артикул"><Input value={sku} onChange={(event) => setSku(event.target.value)} required /></Field>
    <div className="grid grid-cols-3 gap-2"><Field label="Ширина"><Input inputMode="numeric" value={width} onChange={(event) => setWidth(event.target.value)} /></Field><Field label="Высота"><Input inputMode="numeric" value={height} onChange={(event) => setHeight(event.target.value)} /></Field><Field label="Глубина"><Input inputMode="numeric" value={depth} onChange={(event) => setDepth(event.target.value)} /></Field></div>
    <Field label="Занимаемая длина в ряду, мм"><Input inputMode="numeric" min="1" placeholder="Не задана" value={layoutSpan} onChange={(event) => setLayoutSpan(event.target.value)} /></Field>
    <Field label="Изображение"><Select value={assetId} onValueChange={setAssetId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__family__">Изображение семейства</SelectItem>{assets.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.key} · {asset.status === 'APPROVED' ? 'одобрено' : asset.status === 'REJECTED' ? 'отклонено' : 'черновое'}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Подрезка"><Select value={cutPolicy} onValueChange={(value) => setCutPolicy(value as 'allowed' | 'forbidden')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="allowed">Разрешена</SelectItem><SelectItem value="forbidden">Запрещена</SelectItem></SelectContent></Select></Field>
    <div className="flex items-center justify-between rounded-lg border p-3"><Label htmlFor="variant-active">Показывать в каталоге</Label><Switch id="variant-active" checked={active} onCheckedChange={setActive} /></div>
    <Typography as="div" variant="bodySm" tone="muted" className="rounded-lg bg-muted p-3">Расход: корпус {variant.consumptionM2.body} м² · фасад {variant.consumptionM2.facade} м² · ХДФ {variant.consumptionM2.hdf} м² · крепёж {variant.fastenerChargeRub} ₽</Typography>
    <Button type="submit" disabled={disabled}>Сохранить изменения</Button>
  </form></CardContent></Card>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <Label className="grid gap-1.5"><Typography as="span" variant="label">{label}</Typography>{children}</Label> }
function CatalogShell({ children }: { children: React.ReactNode }) { return <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-5 sm:py-12">{children}</section> }
function publicationStatusLabel(status: OwnerCatalogResponse['publicationStatus']) {
  if (status === 'PUBLISHED') return 'Опубликовано'
  if (status === 'AWAITING_RELEASE') return 'Кандидат ожидает выпуска'
  return 'Есть неопубликованные изменения'
}
