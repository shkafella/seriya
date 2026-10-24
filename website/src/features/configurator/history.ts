export const CONFIGURATOR_HISTORY_LIMIT = 50

export type ConfiguratorHistory<State> = {
  past: State[]
  present: State
  future: State[]
}

function clone<State>(value: State): State {
  return structuredClone(value)
}

function equal(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function createHistory<State>(initial: State): ConfiguratorHistory<State> {
  return { past: [], present: clone(initial), future: [] }
}

export function commitHistory<State>(
  history: ConfiguratorHistory<State>,
  next: State,
): ConfiguratorHistory<State> {
  if (equal(history.present, next)) return history
  return {
    past: [...history.past, clone(history.present)].slice(-CONFIGURATOR_HISTORY_LIMIT),
    present: clone(next),
    future: [],
  }
}

export function undoHistory<State>(history: ConfiguratorHistory<State>): ConfiguratorHistory<State> {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: clone(previous),
    future: [clone(history.present), ...history.future],
  }
}

export function redoHistory<State>(history: ConfiguratorHistory<State>): ConfiguratorHistory<State> {
  const [next, ...remaining] = history.future
  if (!next) return history
  return {
    past: [...history.past, clone(history.present)].slice(-CONFIGURATOR_HISTORY_LIMIT),
    present: clone(next),
    future: remaining,
  }
}
