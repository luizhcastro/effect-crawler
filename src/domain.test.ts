import { expect, test } from "bun:test"
import { LOOKBACK_DAYS, periodKey } from "./domain"

test("the period key is stable inside a window and changes at the boundary", () => {
  const monday = new Date("2026-09-14T09:00:00Z")
  const friday = new Date("2026-09-18T23:00:00Z")
  const nextMonday = new Date("2026-09-21T09:00:00Z")

  expect(periodKey("weekly", monday)).toBe(periodKey("weekly", friday))
  expect(periodKey("weekly", monday)).not.toBe(periodKey("weekly", nextMonday))

  expect(periodKey("daily", monday)).toBe("2026-09-14")
  expect(periodKey("daily", friday)).toBe("2026-09-18")

  expect(periodKey("monthly", monday)).toBe("2026-09")
  expect(periodKey("monthly", new Date("2026-10-01T00:00:00Z"))).toBe("2026-10")
})

test("ISO weeks straddle the new year without collapsing", () => {
  // 2026-12-31 is a Thursday, so it belongs to week 53 of 2026
  expect(periodKey("weekly", new Date("2026-12-31T12:00:00Z"))).toBe("2026-W53")
  // 2027-01-01 is the Friday of that same week
  expect(periodKey("weekly", new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53")
  expect(periodKey("weekly", new Date("2027-01-04T12:00:00Z"))).toBe("2027-W01")
})

test("the lookback window matches the frequency", () => {
  expect(LOOKBACK_DAYS).toEqual({ daily: 1, weekly: 7, monthly: 30 })
})
