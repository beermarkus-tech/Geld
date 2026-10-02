// "Tab places the cursor" (Oct 2026, Markus: "on any screen, when I press
// tab after switching screens or reloading the app, the cursor is placed
// either on its previous position or on one of the first visible cells, so I
// don't need to reach for the mouse just to place the cursor once").
//
// Each screen with a cell cursor (Konten, Verlauf, Planung) registers one
// function here that puts the cursor on its remembered cell, or on the first
// cell in view when nothing is remembered yet (e.g. after a reload), and
// returns whether it managed to. App.jsx calls the active screen's function
// when Tab is pressed while nothing has keyboard focus.
const focusers = new Map()

export function registerScreenCursor(screenId, focusFn) {
  focusers.set(screenId, focusFn)
  return () => {
    if (focusers.get(screenId) === focusFn) focusers.delete(screenId)
  }
}

// @returns {boolean} true when a cursor was placed
export function focusScreenCursor(screenId) {
  return focusers.get(screenId)?.() === true
}
