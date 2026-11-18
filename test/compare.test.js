import { expect, test } from "vitest";
import compare from "../src/domain/compare.js";
import matching from "../src/domain/matching.js";
import { cheapestOption, savingsBetween } from "../src/domain/cheapest.mjs";

const { createComparison } = compare;

function option(provider, rating, etaMinutes) {
  return {
    provider,
    restaurantId: "same-restaurant",
    restaurantName: "Same Cafe",
    restaurantLocation: { lat: 12.97, lng: 77.59 },
    dish: "Masala Dosa",
    portion: "single",
    foodType: "veg",
    itemPrice: 180,
    deliveryFee: 0,
    platformFee: 0,
    packagingFee: 0,
    gst: 0,
    discount: 0,
    finalTotal: 180,
    rating,
    ratingCount: 1000,
    etaMinutes,
    distanceKm: 1,
    isOpen: true,
    reliability: { cancellationRate: 0, lateRate: 0 },
    lastUpdated: new Date().toISOString()
  };
}

test("sorts equal-price matches by rating, then delivery time", () => {
  const result = createComparison([
    { status: "fulfilled", value: [option("Zomato", 4.5, 20)] },
    { status: "fulfilled", value: [option("Swiggy", 4.7, 30)] },
    { status: "fulfilled", value: [option("Toing", 4.7, 25)] }
  ], {
    food: "Masala Dosa",
    priority: "Best overall",
    targetPrice: null,
    groupSize: 1,
    radiusKm: 5,
    location: { lat: 12.97, lng: 77.59 }
  });

  expect(result.comparison.options.map((item) => item.provider)).toEqual([
    "Toing", "Swiggy", "Zomato"
  ]);
});

test("matches the same shop across apps by normalized name and nearby location", () => {
  const first = option("Zomato", 4.5, 25);
  const second = {
    ...option("Swiggy", 4.6, 30),
    restaurantName: "  SAME-CAFE ",
    restaurantLocation: { lat: 12.971, lng: 77.59 }
  };
  const grouped = matching.groupListings([first, second]);

  expect(grouped.groups).toHaveLength(1);
  expect(grouped.groups[0].options.map((item) => item.provider)).toEqual(["Zomato", "Swiggy"]);
});

test("chooses the lowest final price and reports same-shop savings", () => {
  const options = [
    { ...option("Zomato", 4.5, 25), itemPrice: 260 },
    { ...option("Swiggy", 4.6, 30), itemPrice: 240 },
    { ...option("Toing", 4.4, 35), itemPrice: 255 }
  ];

  expect(cheapestOption(options).provider).toBe("Swiggy");
  expect(savingsBetween(options)).toBe(20);
});
