import { expect, test } from "vitest";
import search from "../src/domain/search.js";

test("sanitizes markup, collapses whitespace, and limits food names to 60 characters", () => {
  expect(search.sanitizeFood("  <script>alert(1)</script>  Tamil   dish  ")).toBe("Tamil dish");
  expect(search.sanitizeFood("x".repeat(70))).toHaveLength(60);
});

test.each([
  ["porotta", "parotta"],
  ["parotta", "parotta"],
  ["biriyani", "biryani"],
  ["chicken biryani", "biryani"],
  ["briyani", "biryani"],
  ["veg meals", "meals"],
  ["thali", "meals"],
  ["chicken sixty five", "chicken 65"]
])("normalizes synonym %s to %s", (query, expected) => {
  expect(search.canonicalizeFood(query)).toBe(expected);
});

test("matches partial tokens, spelling errors, and Unicode dish names", () => {
  expect(search.matchesFood("biryani", "Chicken Dum Biryani")).toBe(true);
  expect(search.matchesFood("chikcen biryani", "Chicken Dum Biryani")).toBe(true);
  expect(search.matchesFood("panner", "Paneer")).toBe(true);
  expect(search.matchesFood("  BIRYANI!!!  ", "Biryani")).toBe(true);
  expect(search.normalizeText("பன்னீர் டிக்கா")).toBe("பன்னீர் டிக்கா");
});

test("returns at most eight relevant or popular suggestions", () => {
  expect(search.getSuggestions("masala dosa", ["Masala Dosa", "Chicken Dum Biryani"])).toContain("Masala Dosa");
  expect(search.getSuggestions("", [], 8)).toHaveLength(8);
  expect(search.getSuggestions("biry", ["Chicken Dum Biryani"])).toContain("Chicken Dum Biryani");
  expect(search.getSuggestions("custom dish xyz", [])).toEqual([]);
});
