import { expect, test } from "vitest";
import matching from "../src/domain/matching.js";
const { groupListings } = matching;

function listing(overrides = {}) {
  return {
    provider: "Mock",
    restaurantName: "Test Restaurant",
    restaurantLocation: { lat: 12.9719, lng: 77.5942 },
    dish: "Chicken Dum Biryani",
    portion: "single (serves 1)",
    ...overrides
  };
}

test("matches normalized shop names within 150 meters and flags a different portion", () => {
  const { groups, mismatches } = groupListings([
    listing({ provider: "App A" }),
    listing({
      provider: "App B",
      restaurantName: "TEST-RESTAURANT",
      restaurantLocation: { lat: 12.9721, lng: 77.5942 },
      dish: "Chicken Dum Biryani"
    }),
    listing({ provider: "App C", portion: "family (serves 3)" })
  ]);
  expect(groups[0].options).toHaveLength(2);
  expect(groups[1].options).toHaveLength(1);
  expect(mismatches[0].reason).toMatch(/Portion sizes differ/);
});

test("does not group similarly named restaurants more than 150 meters apart", () => {
  const grouped = groupListings([
    listing({ provider: "App A" }),
    listing({
      provider: "App B",
      restaurantLocation: { lat: 12.974, lng: 77.5942 }
    })
  ]);
  expect(grouped.groups).toHaveLength(2);
});
