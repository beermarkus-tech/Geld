// The tag types a grouping tag can have (spec.md §2.5), in the order every
// type picker offers them — "Unbestimmt" first, so a plain Enter on a new name
// creates an untyped tag. Reisekostenart (claim-category; called Anspruchsart until Oct 2026) is only offered in
// Konten once a claim tag is on the line: Meal/Taxi only mean something
// within a trip/claim.
export const CREATE_TYPES = [
  { groupingType: null, label: 'Unbestimmt' },
  { groupingType: 'project', label: 'Reise/Projekt' },
  { groupingType: 'statement', label: 'Abrechnung' },
  { groupingType: 'claim', label: 'Anspruch' },
  { groupingType: 'claim-category', label: 'Reisekostenart' },
]
