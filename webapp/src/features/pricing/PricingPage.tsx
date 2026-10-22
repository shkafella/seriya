import type { OwnerPricingResponse } from '@seriya/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { PricingApi } from './api'

export function PricingPage() {
  const auth = useAuth()
  const api = useMemo(() => new PricingApi(auth.transport), [auth.transport])
  const [pricing, setPricing] = useState<OwnerPricingResponse | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setState('loading'); setMessage('')
    try { setPricing(await api.get()); setState('ready') } catch (error) { setState('error'); setMessage(error instanceof Error ? error.message : 'Не удалось загрузить цены') }
  }, [api])
  useEffect(() => { void load() }, [load])

  const save = async (draft: OwnerPricingResponse['draft'], form: HTMLFormElement) => {
    setState('saving'); setMessage('')
    const data = new FormData(form)
    try {
      const next = await api.editDraft({
        revision: draft.revision,
        materialRates: draft.rates.palette.map((material) => ({ id: material.id, rateRubM2: Number(data.get(`material:${material.id}`)) })),
        packagingRubM2: Number(data.get('packagingRubM2')),
        cutToWidthServiceRub: Number(data.get('cutToWidthServiceRub')),
      })
      setPricing(next); setState('ready'); setMessage('Черновик сохранён. Публичная цена пока не менялась.')
    } catch (error) { setState('ready'); setMessage(error instanceof Error ? `Не сохранено: ${error.message}` : 'Не удалось сохранить черновик') }
  }

  const publish = async () => {
    if (!pricing) return
    setState('saving'); setMessage('')
    try {
      const next = await api.publish(pricing.draft.revision)
      setPricing(next); setState('ready'); setMessage(`Создана версия цен ${next.currentPriceVersion.version}. Для сайта подготовьте и выпустите новый каталог.`)
    } catch (error) { setState('ready'); setMessage(error instanceof Error ? `Не опубликовано: ${error.message}` : 'Не удалось опубликовать цены') }
  }

  if (!auth.user) return <Shell><Typography>Сначала войдите в аккаунт владельца.</Typography></Shell>
  if (!pricing && state === 'loading') return <Shell><div className="flex items-center gap-3"><Spinner /><Typography>Загружаем ставки…</Typography></div></Shell>
  if (!pricing) return <Shell><Typography role="alert" tone="destructive">{message}</Typography><Button onClick={() => void load()}>Повторить</Button></Shell>

  const draftChanged = pricing.draft.basePriceVersionId !== pricing.currentPriceVersion.id
    || JSON.stringify(pricing.draft.rates) !== JSON.stringify(pricing.currentPriceVersion.rates)
  return <Shell>
    <div className="grid gap-2"><div className="flex flex-wrap gap-2"><Badge variant="outline">Версия цен {pricing.currentPriceVersion.version}</Badge><Badge variant={pricing.catalogActivationState === 'IDLE' ? 'secondary' : 'destructive'}>{pricing.catalogActivationState === 'IDLE' ? 'Каталог готов к выпуску' : 'Идёт выпуск каталога'}</Badge></div><Typography variant="h1">Ставки материалов</Typography><Typography tone="muted">Сначала сохраните черновик, затем опубликуйте отдельную версию цен. Уже опубликованный сайт от этого не изменится.</Typography></div>
    {message && <Typography as="div" role="status" className="rounded-lg border bg-muted/40 p-3">{message}</Typography>}
    <form className="grid gap-5" onSubmit={(event) => { event.preventDefault(); void save(pricing.draft, event.currentTarget) }}>
      <Card><CardHeader><CardTitle>Материалы и декоры</CardTitle><CardDescription>{draftChanged ? 'Черновик отличается от опубликованной версии.' : 'Черновик совпадает с опубликованной версией.'}</CardDescription></CardHeader><CardContent className="grid gap-3">{pricing.draft.rates.palette.map((material) => <Label key={material.id} className="grid gap-1"><Typography as="span" variant="label">{material.name} · {material.kind === 'body' ? 'корпус' : material.kind === 'facade' ? 'фасад' : 'ХДФ'}</Typography><Input name={`material:${material.id}`} defaultValue={material.rateRubM2} inputMode="decimal" min="0" type="number" step="0.01" disabled={state === 'saving'} /></Label>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Общие ставки</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Label className="grid gap-1"><Typography as="span" variant="label">Упаковка, ₽/м²</Typography><Input name="packagingRubM2" defaultValue={pricing.draft.rates.packagingRubM2} inputMode="decimal" min="0" type="number" step="0.01" disabled={state === 'saving'} /></Label><Label className="grid gap-1"><Typography as="span" variant="label">Подрезка модуля, ₽</Typography><Input name="cutToWidthServiceRub" defaultValue={pricing.draft.rates.cutToWidthServiceRub} inputMode="decimal" min="0" type="number" step="0.01" disabled={state === 'saving'} /></Label></CardContent></Card>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={state === 'saving'}>Сохранить черновик</Button><Button type="button" variant="secondary" disabled={state === 'saving' || !draftChanged || pricing.catalogActivationState !== 'IDLE'} onClick={() => void publish()}>Опубликовать новую версию цен</Button></div>
    </form>
  </Shell>
}

function Shell({ children }: { children: React.ReactNode }) { return <section className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-5 sm:py-12">{children}</section> }
