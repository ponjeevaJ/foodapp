const http = require("node:http");
const { URL } = require("node:url");
const zomatoAdapter = require("./adapters/zomatoAdapter");
const swiggyAdapter = require("./adapters/swiggyAdapter");
const toingAdapter = require("./adapters/toingAdapter");
const { createComparison } = require("./domain/compare");
const { getMenuItemNames } = require("./data/sampleShopCatalog");
const { getSuggestions, sanitizeFood } = require("./domain/search");

const ADAPTERS = [zomatoAdapter, swiggyAdapter, toingAdapter];
const ADAPTER_TIMEOUT_MS = 3000;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const requestsByIp = new Map();
const locationSuggestionCache = new Map();
let nextReverseGeocodeAt = 0;

function parseNumber(params, key, fallback) {
  const raw = params.get(key);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number.`);
  return value;
}

function parseInput(params) {
  if (!params.has("food")) throw new Error("food is required.");
  const food = sanitizeFood(params.get("food"));
  if (!food) throw new Error("food must contain searchable text.");
  const hasLat = params.has("lat");
  const hasLng = params.has("lng");
  if (hasLat !== hasLng) throw new Error("Provide both lat and lng.");

  let location;
  if (hasLat) {
    const lat = parseNumber(params, "lat");
    const lng = parseNumber(params, "lng");
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("lat or lng is outside its valid range.");
    }
    const area = (params.get("area") || "").trim();
    const city = (params.get("city") || "").trim();
    const country = (params.get("country") || "").trim();
    const label = (params.get("label") || "").trim();
    const address = (params.get("address") || "").trim();
    const pincode = (params.get("pincode") || "").trim();
    const accuracyMeters = params.has("accuracyMeters")
      ? parseNumber(params, "accuracyMeters")
      : null;
    const source = params.get("source");
    if (area.length > 200 || city.length > 200 || country.length > 100 || address.length > 500) {
      throw new Error("Location labels are too long.");
    }
    if (!area || !city || !country || !label) {
      throw new Error("Choose a confirmed location with an area, city, and country.");
    }
    if (!["gps", "manual"].includes(source)) {
      throw new Error("Choose a confirmed location before searching.");
    }
    if (accuracyMeters !== null && accuracyMeters < 0) {
      throw new Error("accuracyMeters must not be negative.");
    }
    location = {
      lat,
      lng,
      address: address || [area, city].filter(Boolean).join(" "),
      label,
      area,
      areaName: area,
      city,
      country,
      pincode,
      source,
      accuracyMeters
    };
  } else {
    throw new Error("Please choose your location.");
  }

  const minPrice = parseNumber(params, "minPrice", 0);
  const maxPrice = parseNumber(params, "maxPrice", 100000);
  const minRating = parseNumber(params, "minRating", 0);
  const radiusKm = parseNumber(params, "radiusKm", 5);
  if (minPrice < 0 || maxPrice < minPrice) throw new Error("Price range is invalid.");
  if (minRating < 0 || minRating > 5) throw new Error("minRating must be between 0 and 5.");
  if (radiusKm <= 0 || radiusKm > 50) throw new Error("radiusKm must be greater than 0 and at most 50.");

  let veg = (params.get("veg") || "both").toLowerCase();
  if (veg === "true") veg = "veg";
  if (veg === "false") veg = "non-veg";
  if (!["veg", "non-veg", "both"].includes(veg)) {
    throw new Error("veg must be veg, non-veg, or both.");
  }
  const priority = params.get("priority") || "Best overall";
  if (!["Cheapest", "Fastest", "Best rated", "Best overall"].includes(priority)) {
    throw new Error("priority is not supported.");
  }
  const targetPrice = params.has("targetPrice") ? parseNumber(params, "targetPrice") : null;
  const groupSize = parseNumber(params, "groupSize", 1);
  if (targetPrice !== null && targetPrice < 0) throw new Error("targetPrice must not be negative.");
  if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 50) {
    throw new Error("groupSize must be an integer between 1 and 50.");
  }
  const shopName = (params.get("shopName") || "").trim();
  if (shopName.length > 120) throw new Error("shopName must be at most 120 characters.");
  return {
    food,
    location,
    radiusKm,
    veg,
    minPrice,
    maxPrice,
    minRating,
    priority,
    targetPrice,
    groupSize,
    shopName
  };
}

function isRateLimited(ip) {
  const now = Date.now();
  const window = requestsByIp.get(ip);
  if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
    requestsByIp.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > RATE_LIMIT;
}

function withTimeout(adapter, input) {
  let timer;
  return Promise.race([
    Promise.resolve().then(() => adapter(input)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Provider timed out.")), ADAPTER_TIMEOUT_MS);
    })
  ]).finally(() => clearTimeout(timer));
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function createAbortError() {
  const error = new Error("Location search was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

async function waitForNominatim(signal) {
  const delay = Math.max(0, nextReverseGeocodeAt - Date.now());
  nextReverseGeocodeAt = Date.now() + delay + 1000;
  if (!delay) {
    throwIfAborted(signal);
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  throwIfAborted(signal);
}

function locationFromNominatim(body, lat, lng) {
  const address = body.address || {};
  const street = [address.house_number, address.road].filter(Boolean).join(" ");
  const area = address.suburb || address.neighbourhood || address.city_district ||
    address.village || address.residential || address.quarter || address.road;
  const city = address.city || address.town || address.municipality ||
    address.village || address.county || address.state_district;
  const state = address.state || "";
  const country = address.country;
  if (!area || !city || !country) return null;
  const pincode = address.postcode || "";
  const parts = [street, area, city, state, pincode].filter(Boolean);
  const label = parts.filter((part, index) =>
    parts.findIndex((candidate) => normalizedLocationText(candidate) === normalizedLocationText(part)) === index
  ).join(", ");
  return {
    label,
    address: label,
    area,
    city,
    country,
    state,
    pincode,
    lat,
    lng
  };
}

function locationFromPhoton(body, lat, lng) {
  const properties = body.features?.[0]?.properties || {};
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const area = properties.suburb || properties.neighbourhood || properties.village ||
    properties.locality || properties.street || properties.name;
  const city = properties.city || properties.town || properties.municipality ||
    properties.county || properties.district;
  const state = properties.state || "";
  const country = properties.country ||
    (String(properties.countrycode || "").toLowerCase() === "in" ? "India" : "");
  if (!area || !city || !country) return null;
  const pincode = properties.postcode || "";
  const parts = [street, area, city, state, pincode].filter(Boolean);
  const label = parts.filter((part, index) =>
    parts.findIndex((candidate) => normalizedLocationText(candidate) === normalizedLocationText(part)) === index
  ).join(", ");
  return {
    label,
    address: label,
    area,
    city,
    country,
    state,
    pincode,
    lat,
    lng
  };
}

async function fetchReverseJson(url, signal, headers) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`Reverse geocoder returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (controller.signal.aborted) throw new Error("Reverse geocoder timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function reverseGeocode(lat, lng, signal) {
  let nominatimError;
  try {
    await waitForNominatim(signal);
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "14");
    url.searchParams.set("addressdetails", "1");
    const body = await fetchReverseJson(url, signal, {
      "User-Agent": "PlatewiseSmartCompare/1.0 (reverse geocoding)",
      Referer: process.env.APP_PUBLIC_URL || "http://localhost:5173/"
    });
    const location = locationFromNominatim(body, lat, lng);
    if (location) return location;
    nominatimError = new Error("Nominatim returned no complete area and city.");
  } catch (error) {
    if (signal?.aborted || error.name === "AbortError") throw error;
    nominatimError = error;
  }

  const photonUrl = new URL("https://photon.komoot.io/reverse");
  photonUrl.searchParams.set("lat", String(lat));
  photonUrl.searchParams.set("lon", String(lng));
  photonUrl.searchParams.set("lang", "en");
  try {
    const body = await fetchReverseJson(photonUrl, signal, {
      "User-Agent": "PlatewiseSmartCompare/1.0 (reverse geocoding)"
    });
    const location = locationFromPhoton(body, lat, lng);
    if (location) return location;
  } catch (error) {
    if (signal?.aborted || error.name === "AbortError") throw error;
    throw new Error(`Address not found. Nominatim: ${nominatimError.message} Photon: ${error.message}`);
  }

  throw new Error(`Address not found. Nominatim: ${nominatimError.message} Photon returned no complete address.`);
}

function removeHouseNumber(query) {
  return query.replace(/^\s*(?:(?:flat|door|house|plot|no\.?|#)\s*)?\d{1,5}(?:[-/]\d+[A-Za-z]?)?(?:[A-Za-z])?\s*(?:,|\s)\s*/iu, "").trim();
}

function getAreaAndCity(query, currentCity) {
  const parts = query.split(",").map((part) => part.trim())
    .filter((part) => part && !/^\d{6}$/.test(part) && !/^india$/i.test(part));
  const cityIndex = currentCity
    ? parts.findIndex((part) => part.toLocaleLowerCase() === currentCity.toLocaleLowerCase())
    : -1;
  if (cityIndex > 0) return { area: parts[cityIndex - 1], city: parts[cityIndex] };
  if (parts.length > 1) return { area: parts[parts.length - 2], city: parts[parts.length - 1] };
  if (parts.length === 1 && currentCity) return { area: parts[0], city: currentCity };
  return null;
}

function locationQueries(query, currentCity) {
  const simplified = removeHouseNumber(query);
  const areaAndCity = getAreaAndCity(simplified, currentCity);
  const candidates = [
    { query, fallback: false },
    { query: simplified, fallback: true },
    { query: areaAndCity ? `${areaAndCity.area}, ${areaAndCity.city}` : "", fallback: true },
    { query: areaAndCity?.area || "", fallback: true }
  ];
  return candidates.filter((candidate, index) =>
    candidate.query.trim() && candidates.findIndex((other) =>
      other.query.trim().toLocaleLowerCase() === candidate.query.trim().toLocaleLowerCase()
    ) === index
  );
}

function normalizedLocationText(value) {
  return String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function createLocationSuggestion({ area, city, country, pincode, lat, lng }) {
  const normalizedArea = area || city;
  const parts = [normalizedArea, city, pincode, country].filter(Boolean);
  const label = parts.filter((part, index) =>
    parts.findIndex((candidate) => normalizedLocationText(candidate) === normalizedLocationText(part)) === index
  ).join(", ");
  if (!normalizedArea || !city || !country || !label ||
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  return {
    label,
    area: normalizedArea,
    city,
    country,
    pincode: String(pincode || ""),
    lat,
    lng,
    source: "manual"
  };
}

function mapNominatimResults(entries, query = "") {
  const requestedPincode = /^\d{6}$/.test(query.trim()) ? query.trim() : "";
  return entries.map((entry) => {
    const address = entry.address || {};
    const city = address.city || address.town || address.municipality ||
      address.village || address.county || address.state_district;
    const name = /^\d{6}$/.test(String(entry.name || "").trim()) ? "" : entry.name;
    const area = address.neighbourhood || address.suburb || address.city_district ||
      address.residential || address.quarter || address.hamlet || address.road ||
      (normalizedLocationText(name) !== normalizedLocationText(city) ? name : "");
    const country = address.country || (String(address.country_code).toLowerCase() === "in" ? "India" : "");
    return createLocationSuggestion({
      area,
      city,
      country,
      pincode: address.postcode || requestedPincode,
      lat: Number(entry.lat),
      lng: Number(entry.lon)
    });
  }).filter((entry) => entry && normalizedLocationText(entry.country) === "india").slice(0, 6);
}

function mapPhotonResults(body, query = "") {
  const requestedPincode = /^\d{6}$/.test(query.trim()) ? query.trim() : "";
  return (body.features || []).map((feature) => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    const city = properties.city || properties.town || properties.municipality ||
      properties.village || properties.county || properties.district;
    const name = /^\d{6}$/.test(String(properties.name || "").trim()) ? "" : properties.name;
    const area = properties.suburb || properties.neighbourhood || properties.locality ||
      properties.district || properties.street ||
      (normalizedLocationText(name) !== normalizedLocationText(city) ? name : "");
    const country = properties.country ||
      (String(properties.countrycode).toLowerCase() === "in" ? "India" : "");
    return createLocationSuggestion({
      area,
      city,
      country,
      pincode: properties.postcode || requestedPincode,
      lat: Number(coordinates[1]),
      lng: Number(coordinates[0])
    });
  }).filter((entry) => entry && normalizedLocationText(entry.country) === "india").slice(0, 6);
}

async function fetchGeocoderJson(url, signal, headers = {}) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers
    });
    if (!response.ok) throw new Error(`Geocoding provider returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (controller.signal.aborted) throw new Error("Geocoding provider timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function softViewbox(bias) {
  if (!Number.isFinite(bias.lat) || !Number.isFinite(bias.lng)) return "";
  const extent = 0.1;
  return [
    bias.lng - extent,
    bias.lat + extent,
    bias.lng + extent,
    bias.lat - extent
  ].join(",");
}

async function searchPhoton(query, bias, signal) {
  const url = new URL("https://photon.komoot.io/api/");
  const photonQuery = /(?:^|,\s*)india$/i.test(query) ? query : `${query}, India`;
  url.searchParams.set("q", photonQuery);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  if (Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    url.searchParams.set("lat", String(bias.lat));
    url.searchParams.set("lon", String(bias.lng));
  }
  const body = await fetchGeocoderJson(url, signal, { "User-Agent": "PlatewiseSmartCompare/1.0" });
  return mapPhotonResults(body, query);
}

async function searchNominatim(query, bias, signal) {
  await waitForNominatim(signal);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("q", query);
  const viewbox = softViewbox(bias);
  if (viewbox) url.searchParams.set("viewbox", viewbox);
  const body = await fetchGeocoderJson(url, signal, {
    "User-Agent": "PlatewiseSmartCompare/1.0 (location autocomplete)",
    Referer: process.env.APP_PUBLIC_URL || "http://localhost:5173/"
  });
  return mapNominatimResults(body, query);
}

async function suggestLocations(query, bias = {}, signal) {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const normalizedBias = {
    city: String(bias.city || "").trim(),
    lat: Number.isFinite(Number(bias.lat)) ? Number(bias.lat) : NaN,
    lng: Number.isFinite(Number(bias.lng)) ? Number(bias.lng) : NaN
  };
  const key = `${normalizedQuery.toLocaleLowerCase()}|${normalizedBias.city.toLocaleLowerCase()}|${normalizedBias.lat}|${normalizedBias.lng}`;
  const cached = locationSuggestionCache.get(key);
  if (cached && Date.now() - cached.createdAt < 60 * 60 * 1000) return cached.result;

  let successfulResponse = false;
  let lastError = null;
  let result = { locations: [], fallback: false, originalQuery: normalizedQuery };
  for (const candidate of locationQueries(normalizedQuery, normalizedBias.city)) {
    let querySucceeded = false;
    for (const [provider, search] of [
      ["photon", searchPhoton],
      ["nominatim", searchNominatim]
    ]) {
      throwIfAborted(signal);
      try {
        const locations = await search(candidate.query, normalizedBias, signal);
        successfulResponse = true;
        querySucceeded = true;
        if (locations.length) {
          result = {
            locations,
            fallback: candidate.fallback,
            provider,
            providerFallback: provider !== "photon",
            originalQuery: normalizedQuery
          };
          break;
        }
      } catch (error) {
        if (signal?.aborted || error.name === "AbortError") throw error;
        lastError = error;
      }
    }
    if (result.locations.length) break;
    if (!querySucceeded) {
      throw new Error("Location service unavailable. Check your internet and try again.");
    }
  }
  if (!successfulResponse && lastError) {
    throw new Error("Location service unavailable. Check your internet and try again.");
  }
  locationSuggestionCache.set(key, { createdAt: Date.now(), result });
  return result;
}

function createServer({ logNoResults = (entry) => console.warn(JSON.stringify(entry)) } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    const ip = request.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) {
      sendJson(response, 429, { error: "Rate limit exceeded. Try again shortly." }, { "retry-after": "60" });
      return;
    }

    if (url.pathname === "/api/suggest") {
      const query = sanitizeFood(url.searchParams.get("q") || "");
      const suggestions = getSuggestions(query, getMenuItemNames(), 8);
      sendJson(response, 200, { suggestions });
      return;
    }

    if (url.pathname === "/api/location-suggest") {
      const query = (url.searchParams.get("q") || "").trim().slice(0, 200);
      if (query.length < 3) {
        sendJson(response, 200, { locations: [], fallback: false, originalQuery: query });
        return;
      }
      const city = (url.searchParams.get("city") || "").trim().slice(0, 100);
      let bias = { city, lat: NaN, lng: NaN };
      try {
        const hasLat = url.searchParams.has("lat");
        const hasLng = url.searchParams.has("lng");
        if (hasLat !== hasLng) throw new Error("Provide both bias coordinates.");
        if (hasLat) {
          bias = { ...bias, lat: parseNumber(url.searchParams, "lat"), lng: parseNumber(url.searchParams, "lng") };
          if (bias.lat < -90 || bias.lat > 90 || bias.lng < -180 || bias.lng > 180) {
            throw new Error("Bias coordinates are outside their valid range.");
          }
        }
      } catch (error) {
        sendJson(response, 400, { error: error.message || "Invalid city bias." });
        return;
      }

      const controller = new AbortController();
      const abortSearch = () => controller.abort();
      const abortIfResponseClosed = () => {
        if (!response.writableEnded) controller.abort();
      };
      request.once("aborted", abortSearch);
      response.once("close", abortIfResponseClosed);
      try {
        const result = await suggestLocations(query, bias, controller.signal);
        if (!controller.signal.aborted && !response.destroyed) sendJson(response, 200, result);
      } catch (error) {
        if (!controller.signal.aborted && !response.destroyed) {
          sendJson(response, 502, { error: error.message || "Location service unavailable. Check your internet and try again." });
        }
      } finally {
        request.removeListener("aborted", abortSearch);
        response.removeListener("close", abortIfResponseClosed);
      }
      return;
    }

    if (url.pathname === "/api/reverse-geocode") {
      let lat;
      let lng;
      try {
        if (!url.searchParams.has("lat") || !url.searchParams.has("lng")) {
          throw new Error("Provide both lat and lng.");
        }
        lat = parseNumber(url.searchParams, "lat");
        lng = parseNumber(url.searchParams, "lng");
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          throw new Error("lat or lng is outside its valid range.");
        }
      } catch (error) {
        sendJson(response, 400, { error: error.message || "Invalid coordinates." });
        return;
      }

      const controller = new AbortController();
      const abortSearch = () => controller.abort();
      const abortIfResponseClosed = () => {
        if (!response.writableEnded) controller.abort();
      };
      request.once("aborted", abortSearch);
      response.once("close", abortIfResponseClosed);
      try {
        const location = await reverseGeocode(lat, lng, controller.signal);
        if (!controller.signal.aborted && !response.destroyed) {
          sendJson(response, 200, { address: location.label, location, addressFound: true });
        }
      } catch (error) {
        if (!controller.signal.aborted && !response.destroyed) {
          sendJson(response, 502, {
            error: error.message || "Address lookup failed.",
            addressFound: false,
            fallbackMessage: "Address not found. Drag the pin or type your area",
            coordinates: { lat, lng }
          });
        }
      } finally {
        request.removeListener("aborted", abortSearch);
        response.removeListener("close", abortIfResponseClosed);
      }
      return;
    }

    if (url.pathname !== "/api/compare") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    let input;
    try {
      input = parseInput(url.searchParams);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Invalid request." });
      return;
    }

    try {
      const strictResults = await Promise.allSettled(
        ADAPTERS.map((adapter) => withTimeout(adapter, { ...input, matchMode: "strict" }))
      );
      const strictListings = strictResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      );
      let selectedResults = strictResults;
      if (strictListings.length) {
        const preferredType = strictListings.some((listing) => listing.matchType === "exact")
          ? "exact"
          : "all-words";
        selectedResults = strictResults.map((result) => result.status === "fulfilled"
          ? { ...result, value: result.value.filter((listing) => listing.matchType === preferredType) }
          : result);
      } else {
        const fuzzyResults = await Promise.allSettled(
          ADAPTERS.map((adapter) => withTimeout(adapter, { ...input, matchMode: "fuzzy" }))
        );
        selectedResults = fuzzyResults.map((result, index) =>
          result.status === "rejected" && strictResults[index].status === "fulfilled"
            ? strictResults[index]
            : result
        );
      }

      const body = createComparison(selectedResults, input);
      body.didYouMean = body.results.length === 0
        ? getSuggestions(input.food, getMenuItemNames(), 8, 0)
          .filter((dish) => dish.toLocaleLowerCase() !== input.food.toLocaleLowerCase()).slice(0, 3)
        : [];
      if (body.results.length === 0) {
        logNoResults({
          event: "food_search_no_results",
          food: input.food,
          timestamp: new Date().toISOString()
        });
      }
      sendJson(response, 200, body);
    } catch (error) {
      sendJson(response, 500, { error: "Comparison failed. Please try again." });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`Smart Compare API listening on http://localhost:${port}`);
  });
}

module.exports = { createServer, parseInput, reverseGeocode, suggestLocations, withTimeout };
