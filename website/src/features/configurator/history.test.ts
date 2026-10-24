import { describe, expect, test } from 'bun:test'

import { commitHistory, createHistory, redoHistory, undoHistory } from './history'

type State = { value: number }

describe('configurator history', () => {
  test('undoes, redoes, and clears redo after a new mutation', () => {
    let history = createHistory<State>({ value: 0 })
    history = commitHistory(history, { value: 1 })
    history = commitHistory(history, { value: 2 })
    history = undoHistory(history)
    expect(history.present.value).toBe(1)
    expect(history.future).toEqual([{ value: 2 }])
    history = redoHistory(history)
    expect(history.present.value).toBe(2)
    history = undoHistory(history)
    history = commitHistory(history, { value: 9 })
    expect(history.future).toEqual([])
  })

  test('retains at most fifty prior configuration snapshots', () => {
    let history = createHistory<State>({ value: 0 })
    for (let value = 1; value <= 75; value += 1) history = commitHistory(history, { value })
    expect(history.past).toHaveLength(50)
    expect(history.past[0]).toEqual({ value: 25 })
  })

  test('does not create a history entry for an unchanged snapshot', () => {
    const history = createHistory<State>({ value: 1 })
    expect(commitHistory(history, { value: 1 })).toBe(history)
  })

  test('undoes and redoes a UI-safe start-side option', () => {
    let history = createHistory({ startSide: 'left' as 'left' | 'right' })
    history = commitHistory(history, { startSide: 'right' })
    history = undoHistory(history)
    expect(history.present.startSide).toBe('left')
    history = redoHistory(history)
    expect(history.present.startSide).toBe('right')
  })
})
