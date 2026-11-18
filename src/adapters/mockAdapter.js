const { calculatePrice } = require("../domain/price");
const { canonicalizeFood, normalizeText } = require("../domain/search");
const { findMenuMatches } = require("../domain/menuSearch");
const { getProviderShops } = require("../data/sampleShopCatalog");
const orderLinkBuilderPromise = import("../domain/orderLinks.mjs");

const EARTH_RADIUS_KM = 6371;
const PROVIDER_FEES = {
  Zomato: { adjustment: 0, deliveryFee: 35, platformFee: 6, packagingFee: 12, ratingCount: 1850 },
  Swiggy: { adjustment: 7, deliveryFee: 18, platformFee: 5, packagingFee: 10, ratingCount: 2420 },
  Toing: { adjustment: -5, deliveryFee: 52, platformFee: 4, packagingFee: 15, ratingCount: 380 }
};

function destinationPoint(center, distanceKm, bearingDegrees) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const bearing = radians(bearingDegrees);
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const latitude = radians(center.lat);
  const longitude = radians(center.lng);
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude)
  );
  return {
    lat: destinationLatitude * 180 / Math.PI,
    lng: destinationLongitude * 180 / Math.PI
  };
}

function haversineDistance(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latDelta = radians(b.lat - a.lat);
  const lngDelta = radians(b.lng - a.lng);
  const value = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function buildSampleShops(provider, location) {
  const fees = PROVIDER_FEES[provider];
  if (!fees) throw new Error(`No sample shop source is configured for ${provider}.`);
  const locationSeed = Math.abs(
    Math.round(location.lat * 1000) + Math.round(location.lng * 1000)
  ) % 9;
  const distanceAdjustmentKm = (locationSeed - 4) * 0.015;
  return getProviderShops(provider).map((template, index) => {
    const distanceKm = Math.max(0.1, template.distanceKm + distanceAdjustmentKm);
    const point = destinationPoint(location, distanceKm, template.bearing + locationSeed * 7);
    return {
      shopId: template.shopId,
      shopName: template.shopName,
      lat: point.lat,
      lng: point.lng,
      rating: template.rating,
      ratingCount: fees.ratingCount + index * 137,
      etaMinutes: template.etaMinutes,
      distanceKm: haversineDistance(location, point),
      menu: template.menu.map((item) => ({
        ...item,
        price: Number((item.price + fees.adjustment).toFixed(2))
      })),
      isSampleData: true
    };
  });
}

function matchCacheKey(provider, options) {
  const { location } = options;
  const shopName = normalizeText(options.shopName);
  return [
    provider,
    canonicalizeFood(options.food),
    Number(location.lat).toFixed(3),
    Number(location.lng).toFixed(3),
    shopName,
    options.veg,
    options.matchMode || "strict"
  ].join("|");
}

function createMockAdapter(provider) {
  const matchCache = new Map();
  return async function search(options) {
    const location = options.location;
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      throw new Error("A confirmed location is required to search nearby shops.");
    }

    const fees = PROVIDER_FEES[provider];
    if (!fees) throw new Error(`No sample shop source is configured for ${provider}.`);
    const shops = buildSampleShops(provider, location);
    const cacheKey = matchCacheKey(provider, options);
    let matches = matchCache.get(cacheKey);
    if (!matches) {
      const requestedShop = normalizeText(options.shopName);
      matches = shops.flatMap((shop) => {
        if (requestedShop && !normalizeText(shop.shopName).includes(requestedShop)) return [];
        return findMenuMatches(options.food, shop.menu, options.matchMode)
          .filter(({ item }) => options.veg === "both" ||
            (options.veg === "veg" ? item.veg : !item.veg))
          .map(({ item, matchType, matchScore }) => ({
            shopId: shop.shopId,
            itemId: item.itemId,
            matchType,
            matchScore: matchScore ?? null
          }));
      });
      matchCache.set(cacheKey, matches);
      if (matchCache.size > 500) matchCache.delete(matchCache.keys().next().value);
    }

    const shopById = new Map(shops.map((shop) => [shop.shopId, shop]));
    const { buildOrderLinks } = await orderLinkBuilderPromise;
    const offers = await Promise.all(matches.map(async (match) => {
      const shop = shopById.get(match.shopId);
      const item = shop?.menu.find((entry) => entry.itemId === match.itemId);
      if (!shop || !item || shop.distanceKm > options.radiusKm ||
        shop.rating < options.minRating) return null;

      const priceInput = {
        itemPrice: item.price,
        deliveryFee: fees.deliveryFee,
        platformFee: fees.platformFee,
        packagingFee: fees.packagingFee,
        gstRate: 0.05,
        offers: []
      };
      const price = await calculatePrice(priceInput);
      if (price.finalTotal < options.minPrice || price.finalTotal > options.maxPrice) return null;

      const listing = {
        provider,
        app: provider,
        shopId: shop.shopId,
        restaurantId: shop.shopId,
        shopName: shop.shopName,
        restaurantName: shop.shopName,
        itemId: item.itemId,
        itemName: item.itemName,
        price: item.price,
        category: item.category,
        menuItem: item,
        dish: item.itemName,
        dishName: item.itemName,
        portion: "single (serves 1)",
        foodType: item.veg ? "veg" : "non-veg",
        itemPrice: item.price,
        deliveryFee: fees.deliveryFee,
        platformFee: fees.platformFee,
        packagingFee: fees.packagingFee,
        gst: price.gst,
        discount: price.discount,
        couponCode: price.couponCode,
        finalTotal: price.finalTotal,
        etaMinutes: shop.etaMinutes,
        rating: shop.rating,
        ratingCount: shop.ratingCount,
        distanceKm: Number(shop.distanceKm.toFixed(2)),
        lat: shop.lat,
        lng: shop.lng,
        area: location.area,
        city: location.city,
        address: location.address,
        restaurantLocation: { lat: shop.lat, lng: shop.lng },
        isOpen: true,
        deepLink: null,
        appShopUrl: null,
        appShopSlug: null,
        webUrl: null,
        lastUpdated: new Date().toISOString(),
        isMock: true,
        isSampleData: true,
        portionSize: "single",
        matchType: match.matchType,
        matchLabel: match.matchType === "fuzzy" ? "Similar to your search" : null,
        reliability: { cancellationRate: 0.02, lateRate: 0.1 },
        freeDeliveryAbove: 399,
        surgeFee: 0,
        history30dAverage: item.price,
        usualPriceRange: [item.price - 15, item.price + 15]
      };
      return { ...listing, ...buildOrderLinks(listing, location) };
    }));

    return offers.filter(Boolean);
  };
}

module.exports = {
  buildSampleShops,
  createMockAdapter,
  destinationPoint,
  haversineDistance
};
