function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value) {
  return Number((value + Number.EPSILON).toFixed(2));
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

function couponSaving(coupon, subtotal, deliveryFee, originalTotal) {
  let saving;
  if (coupon.type === "percent") {
    saving = subtotal * amount(coupon.value) / 100;
    const maxDiscount = Number(coupon.maxDiscount);
    if (coupon.maxDiscount != null && Number.isFinite(maxDiscount)) {
      saving = Math.min(saving, maxDiscount);
    }
  } else if (coupon.type === "flat") {
    saving = amount(coupon.value);
  } else if (coupon.type === "freeDelivery") {
    saving = deliveryFee;
  } else {
    return 0;
  }
  return round(Math.max(0, Math.min(saving, originalTotal)));
}

export function applyBestCoupon(option, coupons, {
  applyCoupons = true,
  includeFirstOrder = false,
  paymentMethod = "",
  stackingAllowedApps = [],
  today = new Date()
} = {}) {
  const itemPrice = amount(option.itemPrice);
  const deliveryFee = amount(option.deliveryFee);
  const originalTotal = round(Math.max(0,
    itemPrice + deliveryFee + amount(option.platformFee) +
    amount(option.packagingFee) + amount(option.gst)
  ));
  const base = {
    ...option,
    deliveryFee,
    discount: 0,
    originalTotal,
    couponCode: null,
    couponTitle: null,
    couponTerms: null,
    couponValidTo: null,
    couponIsSampleData: false,
    couponsEnabled: applyCoupons,
    discountAmount: 0,
    couponApplied: false,
    finalTotal: originalTotal
  };
  if (!applyCoupons) return base;

  const date = dateOnly(today);
  const app = String(option.app || option.provider || "").toLocaleLowerCase();
  const shopId = String(option.shopId || option.restaurantId || "");
  const selectedPaymentMethod = String(paymentMethod || "").toLocaleLowerCase();
  const eligibleCoupons = (coupons || []).filter((coupon) =>
    String(coupon.app || "").toLocaleLowerCase() === app &&
    Boolean(coupon.validFrom && coupon.validTo) &&
    dateOnly(coupon.validFrom) <= date &&
    dateOnly(coupon.validTo) >= date &&
    itemPrice >= amount(coupon.minOrder) &&
    (coupon.shopId == null || String(coupon.shopId) === shopId) &&
    (!coupon.firstOrderOnly || includeFirstOrder) &&
    (!coupon.paymentMethod ||
      (selectedPaymentMethod && String(coupon.paymentMethod).toLocaleLowerCase() === selectedPaymentMethod))
  );
  const savings = eligibleCoupons
    .map((coupon) => ({
      coupon,
      saving: couponSaving(coupon, itemPrice, deliveryFee, originalTotal)
    }))
    .filter(({ saving }) => saving > 0)
    .sort((left, right) => right.saving - left.saving);
  if (!savings.length) return base;

  const canStack = stackingAllowedApps.some((stackableApp) =>
    String(stackableApp).toLocaleLowerCase() === app
  );
  const selected = canStack ? savings : [savings[0]];
  const selectedCoupons = [];
  let freeDeliverySaving = 0;
  for (const entry of selected) {
    if (entry.coupon.type === "freeDelivery") {
      if (freeDeliverySaving) continue;
      freeDeliverySaving = entry.saving;
    }
    selectedCoupons.push(entry);
  }
  const couponSavingTotal = selectedCoupons.reduce((total, entry) =>
    total + (entry.coupon.type === "freeDelivery" ? 0 : entry.saving), 0);
  const totalSaving = round(Math.min(
    originalTotal,
    freeDeliverySaving + couponSavingTotal
  ));
  const cashDiscount = round(Math.min(
    couponSavingTotal,
    Math.max(0, originalTotal - freeDeliverySaving)
  ));
  const isFreeDelivery = freeDeliverySaving > 0;
  return {
    ...base,
    deliveryFee: isFreeDelivery ? 0 : deliveryFee,
    discount: cashDiscount,
    couponCode: selectedCoupons.map(({ coupon }) => coupon.code).join(", "),
    couponTitle: selectedCoupons.map(({ coupon }) => coupon.title).join(" + "),
    couponTerms: selectedCoupons.map(({ coupon }) => `${coupon.code}: ${coupon.terms}`).join(" "),
    couponValidTo: selectedCoupons.map(({ coupon }) => coupon.validTo).join(", "),
    couponIsSampleData: selectedCoupons.every(({ coupon }) => Boolean(coupon.sampleData)),
    discountAmount: totalSaving,
    couponApplied: true,
    finalTotal: round(Math.max(0, originalTotal - totalSaving))
  };
}
