// The tag types a grouping tag can have (spec.md §2.5), in the order every
// type picker offers them — "Unbestimmt" first, so a plain Enter on a new name
// creates an untyped tag. Dienstreise (Oct 2026, Markus — replaces the old
// flat "Reisekostenart"/claim-category type) is a claim like Anspruch, with
// per-trip children for the kind of expense ("2024-05 HAM: Hotel").
export const CREATE_TYPES = [
  { groupingType: null, label: 'Unbestimmt' },
  { groupingType: 'project', label: 'Reise/Projekt' },
  { groupingType: 'statement', label: 'Abrechnung' },
  { groupingType: 'claim', label: 'Anspruch' },
  { groupingType: 'business-trip', label: 'Dienstreise' },
]
