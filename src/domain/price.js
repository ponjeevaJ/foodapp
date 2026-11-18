function offerDiscount(offer, itemPrice) {
  itemPrice = Number(itemPrice);
  if (itemPrice < offer.minOrder) return 0;
  const discount = offer.type === "percent"
    ? itemPrice * offer.value / 100
    : offer.value;
  return Math.max(0, Math.min(discount, offer.maxDiscount ?? discount, itemPrice));
}

function chooseBestOffer(offers, itemPrice) {
  return (offers || [])
    .map((offer) => ({ ...offer, discount: offerDiscount(offer, itemPrice) }))
    .sort((a, b) => b.discount - a.discount)[0] || { discount: 0, code: null };
}

async function calculatePrice(listing, offers = listing.offers || []) {
  const { calculateFinalPrice } = await import("./calculateFinalPrice.mjs");
  const itemPrice = Number(listing.itemPrice);
  const deliveryFee = Number(listing.deliveryFee);
  const platformFee = Number(listing.platformFee);
  const packagingFee = Number(listing.packagingFee);
  const selectedOffer = chooseBestOffer(offers, itemPrice);
  const gst = Number(((itemPrice + packagingFee) * Number(listing.gstRate || 0)).toFixed(2));
  const discount = Number(selectedOffer.discount.toFixed(2));
  const finalTotal = calculateFinalPrice({
    itemPrice,
    deliveryFee,
    platformFee,
    packagingFee,
    gst,
    discount
  });

  return { gst, discount, couponCode: selectedOffer.code || null, finalTotal };
}

module.exports = { calculatePrice, chooseBestOffer };
