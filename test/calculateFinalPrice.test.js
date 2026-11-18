import { expect, test } from "vitest";
import { calculateFinalPrice } from "../src/domain/calculateFinalPrice.mjs";

test("adds numeric-string components, rounds to cents, and never returns a negative total", () => {
  expect(calculateFinalPrice({
    itemPrice: "100",
    deliveryFee: "20",
    platformFee: 4.5,
    packagingFee: 5,
    gst: 3.25,
    discount: "10.10"
  })).toBe(122.65);
  expect(calculateFinalPrice({ itemPrice: 1, discount: 5 })).toBe(0);
});
