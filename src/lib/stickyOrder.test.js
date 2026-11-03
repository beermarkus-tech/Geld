import { describe, expect, it } from 'vitest'

import { createStickyOrder, stickyReorder } from './stickyOrder'

describe('stickyReorder', () => {
  it('free sort when nothing is locked', () => {
    expect(stickyReorder(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c'])
  })
  it('keeps the locked order when an edit would re-sort a row', () => {
    expect(stickyReorder(['b', 'c', 'a'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('puts unseen rows after their sorted predecessor', () => {
    expect(stickyReorder(['a', 'n', 'b', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'n', 'b', 'c'])
    expect(stickyReorder(['n', 'a', 'b'], ['a', 'b'])).toEqual(['n', 'a', 'b'])
    expect(stickyReorder(['a', 'n', 'm', 'b'], ['a', 'b'])).toEqual(['a', 'n', 'm', 'b'])
    // new row whose sorted place is far away still lands next to its sorted neighbour, not wherever the edit moves it
    expect(stickyReorder(['a', 'b', 'c', 'n'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c', 'n'])
  })
  it('forgets rows that are gone', () => {
    expect(stickyReorder(['a', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'c'])
  })
})

describe('createStickyOrder', () => {
  const node = (id, child = false) => ({ id, child })
  const key = (n) => n.id
  const isChild = (n) => n.child
  it('holds order across edits, releases on a sort change, keeps child rows behind their parent', () => {
    const s = createStickyOrder()
    let nodes = [node('a'), node('b'), node('b-1', true), node('c')]
    s.apply(nodes, 'date:asc', key, isChild)
    // an edit makes b sort last – the table still shows the old order
    nodes = [node('a'), node('c'), node('b'), node('b-1', true)]
    s.apply(nodes, 'date:asc', key, isChild)
    expect(nodes.map(key)).toEqual(['a', 'b', 'b-1', 'c'])
    // sorting by hand applies the new sort
    nodes = [node('c'), node('b'), node('b-1', true), node('a')]
    s.apply(nodes, 'date:desc', key, isChild)
    expect(nodes.map(key)).toEqual(['c', 'b', 'b-1', 'a'])
  })
})
