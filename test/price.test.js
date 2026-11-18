import { expect, test } from "vitest";
import price from "../src/domain/price.js";
const { calculatePrice, chooseBestOffer } = price;

test("calculates every price component and the final total", async () => {
  const result = await calculatePrice({
    itemPrice: 200,
    deliveryFee: 20,
    platformFee: 5,
    packagingFee: 10,
    gstRate: 0.05,
    offers: [{ code: "SAVE20", type: "fixed", value: 20, minOrder: 100 }]
  });
  expect(result).toEqual({ gst: 10.5, discount: 20, couponCode: "SAVE20", finalTotal: 225.5 });
});

test("coerces string prices and clamps a negative final total to zero", async () => {
  const result = await calculatePrice({
    itemPrice: "12.50",
    deliveryFee: "0",
    platformFee: "0",
    packagingFee: "0",
    gstRate: 0,
    offers: [{ code: "SAVE", type: "fixed", value: 100, minOrder: 0 }]
  });

  expect(result.finalTotal).toBe(0);
});

test("chooses one best eligible offer and ignores offers below their minimum", () => {
  const offer = chooseBestOffer([
    { code: "INELIGIBLE", type: "fixed", value: 90, minOrder: 300 },
    { code: "PERCENT", type: "percent", value: 20, maxDiscount: 30, minOrder: 100 },
    { code: "FIXED", type: "fixed", value: 25, minOrder: 100 }
  ], 150);
  expect(offer.code).toBe("PERCENT");
  expect(offer.discount).toBe(30);
});
