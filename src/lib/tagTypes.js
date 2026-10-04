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
  { groupingType: 'health-insurance', label: 'Krankenkasse' },
]

// The types that are claims (Außenstände). Krankenkasse (Oct 2026, Markus)
// works exactly like Anspruch and Dienstreise — its own type only to keep
// health-insurance claims apart in the lists.
export const CLAIM_TYPES = new Set(['claim', 'business-trip', 'health-insurance'])
