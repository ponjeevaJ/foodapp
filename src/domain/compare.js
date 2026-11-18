const { scoreOptions, WEIGHTS } = require("./scoring");
const { groupListings, tokenSimilarity } = require("./matching");
const { fuzzyScore } = require("./search");

const PROVIDERS = ["Zomato", "Swiggy", "Toing"];
const EARTH_RADIUS_KM = 6371;

function haversineDistance(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latDelta = radians(b.lat - a.lat);
  const lngDelta = radians(b.lng - a.lng);
  const value = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function getBadges(options) {
  if (options.length === 0) return {};
  const min = (key) => options.reduce((best, option) => option[key] < best[key] ? option : best);
  const max = (key) => options.reduce((best, option) => option[key] > best[key] ? option : best);
  const bestValue = options.reduce((best, option) =>
    option.score / Math.max(option.finalTotal, 1) > best.score / Math.max(best.finalTotal, 1)
      ? option : best
  );
  return {
    cheapest: min("finalTotal").provider,
    fastest: min("etaMinutes").provider,
    highestRated: max("rating").provider,
    bestValue: bestValue.provider
  };
}

function recommendationReason(winner, options) {
  if (options.length < 2) return "The only matching option available for this dish.";
  const highestPrice = Math.max(...options.map((option) => option.finalTotal));
  const slowestEta = Math.max(...options.map((option) => option.etaMinutes));
  const savings = Number((highestPrice - winner.finalTotal).toFixed(2));
  const faster = slowestEta - winner.etaMinutes;
  const highlights = [];
  if (savings > 0) highlights.push(`₹${savings} cheaper than the most expensive option`);
  if (faster > 0) highlights.push(`${faster} minutes faster than the slowest option`);
  if (highlights.length === 0) highlights.push(`best weighted score (${winner.score}/100)`);
  return `${winner.provider} is ${highlights.join(" and ")}.`;
}

function intelligence(options, allGroups, targetPrice, groupSize) {
  const winner = options[0];
  if (!winner) return {};
  const alternatives = allGroups.flatMap((group) => group.options)
    .filter((option) => option !== winner &&
      option.portion === winner.portion &&
      option.foodType === winner.foodType &&
      tokenSimilarity(option.dish, winner.dish) >= 0.5 &&
      option.distanceKm <= 5 &&
      option.finalTotal < winner.finalTotal)
    .sort((a, b) => a.finalTotal - b.finalTotal);

  return {
    freeDeliveryTracker: winner.deliveryFee > 0 && winner.itemPrice < winner.freeDeliveryAbove
      ? {
          provider: winner.provider,
          addAmount: Number((winner.freeDeliveryAbove - winner.itemPrice).toFixed(2)),
          threshold: winner.freeDeliveryAbove
        }
      : null,
    hiddenFeeAlert: (winner.deliveryFee + winner.platformFee + winner.packagingFee + winner.gst) >=
      winner.itemPrice * 0.25,
    peakHourWarning: winner.surgeFee >= 15
      ? `Peak-hour fee is ₹${winner.surgeFee}; consider ordering later.`
      : null,
    nearbyAlternative: alternatives.length > 0
      ? {
          provider: alternatives[0].provider,
          restaurantName: alternatives[0].restaurantName,
          dish: alternatives[0].dish,
          finalTotal: alternatives[0].finalTotal,
          distanceKm: alternatives[0].distanceKm
        }
      : null,
    priceHistory: {
      average30d: winner.history30dAverage,
      difference: Number((winner.itemPrice - winner.history30dAverage).toFixed(2)),
      trend: winner.itemPrice > winner.history30dAverage
        ? "higher"
        : winner.itemPrice < winner.history30dAverage ? "lower" : "usual"
    },
    priceDropAlert: Number.isFinite(targetPrice)
      ? { targetPrice, reached: winner.finalTotal <= targetPrice }
      : null,
    groupSplit: {
      groupSize,
      amountPerPerson: Number((winner.finalTotal / groupSize).toFixed(2))
    }
  };
}

function createComparison(adapterResults, input) {
  const candidates = adapterResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  const available = candidates.flatMap((listing) => {
    const shopLocation = listing.restaurantLocation || { lat: listing.lat, lng: listing.lng };
    if (!Number.isFinite(shopLocation.lat) || shopLocation.lat < -90 || shopLocation.lat > 90 ||
      !Number.isFinite(shopLocation.lng) || shopLocation.lng < -180 || shopLocation.lng > 180) {
      return [];
    }
    const distanceKm = Number(haversineDistance(input.location, shopLocation).toFixed(2));
    if (distanceKm > input.radiusKm) return [];
    return [{
      ...listing,
      lat: shopLocation.lat,
      lng: shopLocation.lng,
      restaurantLocation: shopLocation,
      distanceKm
    }];
  });
  const { groups: foundGroups, mismatches } = groupListings(available);
  const rankedGroups = foundGroups.map((group) => ({
    ...group,
    options: scoreOptions(group.options, input.priority).sort((a, b) =>
      a.finalTotal - b.finalTotal ||
      Number(b.rating) - Number(a.rating) ||
      Number(a.etaMinutes) - Number(b.etaMinutes)
    )
  }));
  const relevance = (group) => fuzzyScore(group.dish, input.food);
  rankedGroups.sort((a, b) =>
    a.options[0].finalTotal - b.options[0].finalTotal ||
    relevance(b) - relevance(a) ||
    b.options.length - a.options.length
  );

  const primaryGroup = rankedGroups[0] || null;
  const options = primaryGroup ? primaryGroup.options : [];
  const providers = PROVIDERS.map((provider, index) => ({
    provider,
    status: adapterResults[index].status === "fulfilled" ? "available" : "unavailable"
  }));
  const winner = options[0] || null;
  const highestTotal = options.length ? Math.max(...options.map((option) => option.finalTotal)) : 0;
  const savings = options.length
    ? Number((highestTotal - Math.min(...options.map((option) => option.finalTotal))).toFixed(2))
    : 0;
  const elapsedMinutes = winner
    ? Math.max(0, Math.floor((Date.now() - Date.parse(winner.lastUpdated)) / 60000))
    : 0;

  return {
    priority: input.priority,
    weights: WEIGHTS[input.priority],
    results: rankedGroups.flatMap((group) => group.options),
    providers,
    comparison: primaryGroup,
    groups: rankedGroups,
    location: input.location,
    mismatches,
    recommendation: winner ? {
      bestOverall: winner,
      reason: recommendationReason(winner, options),
      badges: getBadges(options),
      savings,
      savingsMessage: `You save ₹${savings} compared with the most expensive app.`,
      orderUrl: winner.deepLink,
      warnings: [
        "Price may differ slightly in the app.",
        `Last updated ${elapsedMinutes} min ago.`
      ]
    } : null,
    intelligence: intelligence(options, rankedGroups, input.targetPrice, input.groupSize),
    unavailableProviders: providers
      .filter((provider) => provider.status === "unavailable")
      .map((provider) => provider.provider)
  };
}

module.exports = { createComparison, PROVIDERS };
