function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateFinalPrice(option) {
  const total = amount(option.itemPrice) +
    amount(option.deliveryFee) +
    amount(option.platformFee) +
    amount(option.packagingFee) +
    amount(option.gst) -
    amount(option.discount);
  return Math.max(0, Number((total + Number.EPSILON).toFixed(2)));
}
