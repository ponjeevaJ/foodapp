import { expect, test } from "vitest";
import scoring from "../src/domain/scoring.js";
const { scoreOptions, WEIGHTS } = scoring;

function option(overrides = {}) {
  return {
    provider: "Mock",
    finalTotal: 200,
    rating: 4.5,
    ratingCount: 1000,
    etaMinutes: 30,
    isOpen: true,
    distanceKm: 2,
    reliability: { cancellationRate: 0.02, lateRate: 0.1 },
    ...overrides
  };
}

test("scores and sorts options using weighted criteria", () => {
  const result = scoreOptions([
    option({ provider: "Expensive", finalTotal: 300, rating: 5, ratingCount: 3 }),
    option({ provider: "Balanced", finalTotal: 220, rating: 4.6, ratingCount: 2000, etaMinutes: 25 })
  ]);
  expect(result[0].provider).toBe("Balanced");
  expect(result[0].score).toBeGreaterThanOrEqual(0);
  expect(result[0].score).toBeLessThanOrEqual(100);
  expect(Object.keys(result[0].scoreBreakdown)).toEqual([
    "price", "rating", "delivery", "reliability", "distance"
  ]);
});

test("applies priority weights and gives closed restaurants zero reliability", () => {
  expect(WEIGHTS.Cheapest.price).toBe(70);
  const result = scoreOptions([
    option({ provider: "Closed", isOpen: false }),
    option({ provider: "Open", finalTotal: 210 })
  ], "Cheapest");
  expect(result.find((item) => item.provider === "Closed").scoreBreakdown.reliability).toBe(0);
  expect(result[0].provider).toBe("Closed");
});

test("rejects unknown priorities", () => {
  expect(() => scoreOptions([option()], "Random")).toThrow(/Unsupported priority/);
});
