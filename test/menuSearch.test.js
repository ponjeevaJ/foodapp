import { expect, test } from "vitest";
import menuSearch from "../src/domain/menuSearch.js";

const { findMenuMatches } = menuSearch;

const chickenMenu = [
  { itemId: "fried-rice", itemName: "Chicken Fried Rice", category: "Rice", price: 220, veg: false },
  { itemId: "rice-bowl", itemName: "Chicken Rice Bowl", category: "Rice Bowl", price: 235, veg: false },
  { itemId: "biryani", itemName: "Chicken Dum Biryani", category: "Biryani", price: 255, veg: false }
];

test("prioritizes an exact menu item over broader word matches", () => {
  const menu = [
    { itemId: "exact", itemName: "Paneer Butter Masala", category: "Curry" },
    { itemId: "wrap", itemName: "Paneer Butter Masala Wrap", category: "Rolls" }
  ];

  expect(findMenuMatches("paneer butter masala", menu).map(({ item, matchType }) => [
    item.itemName,
    matchType
  ])).toEqual([["Paneer Butter Masala", "exact"]]);
});

test("requires every query word and excludes Chicken Biryani for chicken rice", () => {
  const results = findMenuMatches("chicken rice", chickenMenu);
  expect(results.map(({ item }) => item.itemName)).toEqual([
    "Chicken Fried Rice",
    "Chicken Rice Bowl"
  ]);
  expect(results.some(({ item }) => item.itemName.includes("Biryani"))).toBe(false);
});

test("uses a strict fuzzy tier only when strict matching has no results", () => {
  const results = findMenuMatches("chikcen frid rice", chickenMenu, "fuzzy");
  expect(results.some(({ item, matchType }) =>
    item.itemName === "Chicken Fried Rice" && matchType === "fuzzy"
  )).toBe(true);
});

test("returns no item when no menu entry reaches the fuzzy threshold", () => {
  expect(findMenuMatches("unrelated dessert", chickenMenu, "fuzzy")).toEqual([]);
});
