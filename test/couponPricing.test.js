import { expect, test } from "vitest";
import { applyBestCoupon } from "../src/domain/couponPricing.mjs";

const today = "2026-11-17";
const option = {
  app: "Zomato",
  provider: "Zomato",
  restaurantId: "shop-1",
  itemPrice: 200,
  deliveryFee: 20,
  platformFee: 5,
  packagingFee: 10,
  gst: 10
};

function coupon(overrides) {
  return {
    id: "coupon",
    app: "Zomato",
    code: "SAMPLE",
    title: "Sample coupon",
    type: "flat",
    value: 10,
    maxDiscount: null,
    minOrder: 100,
    validFrom: "2026-01-01",
    validTo: "2027-12-31",
    shopId: null,
    firstOrderOnly: false,
    paymentMethod: null,
    terms: "Sample terms",
    sampleData: true,
    ...overrides
  };
}

test("caps a percentage coupon at maxDiscount", () => {
  const priced = applyBestCoupon(option, [
    coupon({ type: "percent", value: 25, maxDiscount: 30 })
  ], { today });

  expect(priced).toMatchObject({
    originalTotal: 245,
    couponCode: "SAMPLE",
    discountAmount: 30,
    finalTotal: 215,
    couponApplied: true
  });
});

test("skips a flat coupon when subtotal is below minOrder", () => {
  const priced = applyBestCoupon({ ...option, itemPrice: 99 }, [
    coupon({ value: 50, minOrder: 100 })
  ], { today });

  expect(priced.couponApplied).toBe(false);
  expect(priced.finalTotal).toBe(priced.originalTotal);
});

test("ignores expired coupons and coupons belonging to another app", () => {
  const priced = applyBestCoupon(option, [
    coupon({ code: "EXPIRED", validTo: "2026-11-16", value: 200 }),
    coupon({ code: "OTHER-APP", app: "Swiggy", value: 200 })
  ], { today });

  expect(priced.couponApplied).toBe(false);
  expect(priced.couponCode).toBeNull();
});

test("free-delivery coupons zero the delivery fee and count that saving", () => {
  const priced = applyBestCoupon(option, [
    coupon({ type: "freeDelivery", value: 0 })
  ], { today });

  expect(priced).toMatchObject({
    deliveryFee: 0,
    discountAmount: 20,
    finalTotal: 225,
    couponApplied: true
  });
});

test("chooses the largest eligible saving and clamps final total to zero", () => {
  const priced = applyBestCoupon(option, [
    coupon({ code: "SMALL", value: 25 }),
    coupon({ code: "LARGE", value: 400 })
  ], { today });

  expect(priced.couponCode).toBe("LARGE");
  expect(priced.discountAmount).toBe(245);
  expect(priced.finalTotal).toBe(0);
});

test("skips first-order and payment-specific coupons until their filters are enabled", () => {
  const offers = [
    coupon({ code: "FIRST", value: 40, firstOrderOnly: true }),
    coupon({ code: "UPI", value: 30, paymentMethod: "UPI" })
  ];

  expect(applyBestCoupon(option, offers, { today }).couponApplied).toBe(false);
  expect(applyBestCoupon(option, offers, {
    today,
    includeFirstOrder: true,
    paymentMethod: "UPI"
  }).couponCode).toBe("FIRST");
  expect(applyBestCoupon(option, offers, {
    today,
    paymentMethod: "UPI"
  }).couponCode).toBe("UPI");
});

test("applies only coupons scoped to this shop", () => {
  const priced = applyBestCoupon(option, [
    coupon({ shopId: "different-shop", value: 100 })
  ], { today });
  expect(priced.couponApplied).toBe(false);
});

test("stacks coupons only for apps explicitly allowed to stack", () => {
  const priced = applyBestCoupon(option, [
    coupon({ code: "STACK-A", value: 20 }),
    coupon({ code: "STACK-B", type: "percent", value: 10 })
  ], {
    today,
    stackingAllowedApps: ["Zomato"]
  });

  expect(priced.couponCode).toBe("STACK-A, STACK-B");
  expect(priced.discountAmount).toBe(40);
  expect(priced.finalTotal).toBe(205);
});
