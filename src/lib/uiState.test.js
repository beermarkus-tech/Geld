import { describe, expect, it } from 'vitest'

import { createUiState } from './uiState'

const memory = (initial = {}) => {
  const m = { ...initial }
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => void (m[k] = v), removeItem: (k) => void delete m[k], raw: m }
}
// timers that run only when asked
const manual = () => {
  const queue = []
  return { setTimer: (fn) => (queue.push(fn), queue.length), clearTimer: () => {}, run: () => queue.splice(0).forEach((f) => f()) }
}

describe('uiState', () => {
  it('remembers a value across sessions after the write delay', () => {
    const store = memory()
    const t = manual()
    const a = createUiState(store, t)
    a.set('konten', 'showDeleted', true)
    expect(store.raw['geld-ui-state']).toBeUndefined() // debounced
    t.run()
    const b = createUiState(store, manual())
    expect(b.get('konten', 'showDeleted')).toBe(true)
    expect(b.get('konten', 'missing', 'dflt')).toBe('dflt')
  })

  it('writes at once on flush and skips writes that change nothing', () => {
    const store = memory()
    const s = createUiState(store, manual())
    s.set('x', 'k', 1)
    s.flush()
    const first = store.raw['geld-ui-state']
    expect(JSON.parse(first)).toEqual({ x: { k: 1 }, v: 1 })
    s.set('x', 'k', 1)
    s.flush()
    expect(store.raw['geld-ui-state']).toBe(first)
  })

  it('ignores corrupt or other-version data', () => {
    expect(createUiState(memory({ 'geld-ui-state': '{not json' }), manual()).get('a', 'b')).toBeNull()
    expect(createUiState(memory({ 'geld-ui-state': JSON.stringify({ v: 99, a: { b: 1 } }) }), manual()).get('a', 'b')).toBeNull()
  })

  it('drops the saved state once after a crash was marked, and only then', () => {
    const store = memory({ 'geld-ui-state': JSON.stringify({ v: 1, a: { b: 1 } }) })
    createUiState(store, manual()).markCrashed()
    const afterCrash = createUiState(store, manual())
    expect(afterCrash.crashed).toBe(true)
    expect(afterCrash.get('a', 'b')).toBeNull()
    expect(store.raw['geld-ui-state']).toBeUndefined()
    afterCrash.set('a', 'b', 2)
    afterCrash.flush()
    expect(createUiState(store, manual()).get('a', 'b')).toBe(2) // normal again from the second start on
  })

  it('keeps the state however often the app is reloaded quickly', () => {
    const store = memory({ 'geld-ui-state': JSON.stringify({ v: 1, a: { b: 1 } }) })
    for (let i = 0; i < 5; i++) expect(createUiState(store, manual()).get('a', 'b')).toBe(1)
  })

  it('survives a storage that throws', () => {
    const broken = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } }
    const s = createUiState(broken, manual())
    s.set('a', 'b', 2)
    expect(() => s.flush()).not.toThrow()
    expect(s.get('a', 'b')).toBe(2)
  })
})
