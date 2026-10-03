import { tagColorVar } from './lib/tagStyle'

// The one way a tag is drawn (PLAN.md Phase 5b, step 3 — Oct 2026, Markus):
// a rounded pill tinted in its type's colour (Reise/Projekt green, Anspruch
// purple, …), or a dashed neutral outline for a tag without a type and for
// old plain-text tags. Used by Konten's Tags column, the tag boxes, Verlauf's
// line names and Settings.
//
//   size  'sm' (in table cells and lists) or 'md' (Settings)
//   as    'span' (default) or 'button'
// Anything else (onClick, title, ref, …) goes to the element.

const SIZES = { sm: 'px-1.5 py-0.5 text-xs', md: 'px-2 py-0.5 text-sm' }

// Class and style for a tag's pill — for the rare place that has to build its
// own element (Konten's "Parent: Child" pill with two clickable halves).
export function pillLook(tag, size = 'sm') {
  const colorVar = tagColorVar(tag)
  return {
    className: `inline-block max-w-full truncate rounded-full align-middle ${SIZES[size]} ${colorVar ? '' : 'border border-dashed border-[var(--color-text-muted)] text-[var(--color-text-muted)]'}`,
    style: colorVar ? { color: `var(${colorVar})`, backgroundColor: `color-mix(in srgb, var(${colorVar}) 15%, transparent)` } : undefined,
  }
}

// A type's look without a tag (the "Neu … — Reise/Projekt" create rows).
export const typeLook = (groupingType) => (groupingType ? { class: 'grouping', groupingType } : null)

export default function TagPill({ tag, size = 'sm', as: Element = 'span', className = '', children, ...rest }) {
  const look = pillLook(tag, size)
  return (
    <Element {...(Element === 'button' ? { type: 'button' } : {})} {...rest} className={`${look.className} ${className}`} style={look.style}>
      {children ?? tag?.name}
    </Element>
  )
}

// A row in a tag list: the highlighted row is tinted rather than solid blue, so
// the coloured pills stay readable on it.
export const listRowClass = (highlighted) =>
  `flex w-full items-center gap-2 px-2 py-1 text-left ${highlighted ? 'bg-[color-mix(in_srgb,var(--color-computed)_18%,transparent)]' : 'hover:bg-[var(--color-bg)]'}`
