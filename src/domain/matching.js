const { canonicalizeFood, normalizeText } = require("./search");

function normalize(value) {
  return normalizeText(value);
}

function tokenSimilarity(left, right) {
  const a = new Set(canonicalizeFood(left).split(/\s+/).filter(Boolean));
  const b = new Set(canonicalizeFood(right).split(/\s+/).filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return (2 * intersection) / (a.size + b.size);
}

function distanceBetween(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latDelta = radians(b.lat - a.lat);
  const lngDelta = radians(b.lng - a.lng);
  const value = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function sameRestaurant(a, b) {
  return normalize(a.restaurantName) === normalize(b.restaurantName) &&
    distanceBetween(a.restaurantLocation, b.restaurantLocation) <= 0.15;
}

function sameDish(a, b) {
  return normalize(a.itemName || a.dish) === normalize(b.itemName || b.dish) &&
    normalize(a.portion) === normalize(b.portion);
}

function groupListings(listings) {
  const groups = [];
  const mismatches = [];
  for (const listing of listings) {
    const group = groups.find((candidate) =>
      sameRestaurant(candidate.options[0], listing) &&
      sameDish(candidate.options[0], listing)
    );
    if (group) {
      group.options.push(listing);
      continue;
    }

    const related = groups.find((candidate) => sameRestaurant(candidate.options[0], listing));
    if (related) {
      mismatches.push({
        restaurantName: listing.restaurantName,
        dish: listing.dish,
        portion: listing.portion,
        comparedWith: related.options[0].dish,
        comparedPortion: related.options[0].portion,
        reason: normalize(listing.portion) !== normalize(related.options[0].portion)
          ? "Portion sizes differ; not included in the same comparison."
          : "Dish names differ; not included in the same comparison."
      });
    }
    groups.push({ options: [listing] });
  }

  return {
    groups: groups.map((group) => ({
      restaurantName: group.options[0].restaurantName,
      dish: group.options[0].dish,
      portion: group.options[0].portion,
      options: group.options
    })),
    mismatches
  };
}

module.exports = { groupListings, sameDish, sameRestaurant, tokenSimilarity };
