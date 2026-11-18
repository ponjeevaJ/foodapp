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
const reverseGeocodeCache = new Map();
const GEOCODER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GEOCODER_CACHE_MAX_ENTRIES = 500;
const TAMIL_NADU_VIEWBOX = "76.2,13.6,80.4,8.0";
let nextNominatimRequestAt = 0;

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
    const district = (params.get("district") || "").trim();
    const address = (params.get("address") || [area, city].filter(Boolean).join(" ")).trim();
    const label = (params.get("label") || "").trim() || address;
    const pincode = (params.get("pincode") || "").trim();
    const accuracyMeters = params.has("accuracyMeters")
      ? parseNumber(params, "accuracyMeters")
      : null;
    const source = params.get("source");
    if (area.length > 500 || city.length > 200 || district.length > 200 ||
      country.length > 100 || address.length > 500) {
      throw new Error("Location labels are too long.");
    }
    if (!address || !label) {
      throw new Error("Choose a confirmed location with an address.");
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
      address,
      label,
      area: area || address,
      areaName: area || address,
      city,
      district,
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

function cacheGeocoderResult(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > GEOCODER_CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

async function waitForNominatim(signal) {
  const delay = Math.max(0, nextNominatimRequestAt - Date.now());
  nextNominatimRequestAt = Date.now() + delay + 1000;
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
    address.residential || address.quarter || address.road || address.village;
  const city = address.city || address.town || address.village || address.municipality;
  const district = address.state_district || address.county || "";
  const state = address.state || "";
  const country = address.country || "";
  const pincode = String(address.postcode || "");
  const parts = [street, area, city, district, state, pincode].filter(Boolean);
  const label = parts.filter((part, index) =>
    parts.findIndex((candidate) => normalizedLocationText(candidate) === normalizedLocationText(part)) === index
  ).join(", ");
  if (!label || !state) return null;
  return {
    label,
    address: label,
    area: area || city || district,
    city: city || district,
    district,
    country,
    state,
    pincode,
    lat,
    lng
  };
}

function requireTamilNadu(location) {
  if (!location) throw new Error("Nominatim returned no usable address. Type the address manually.");
  if (normalizedLocationText(location.state) !== "tamilnadu") {
    const error = new Error("This location service covers Tamil Nadu only. Choose a point within Tamil Nadu.");
    error.code = "OUTSIDE_TAMIL_NADU";
    throw error;
  }
  return location;
}

async function fetchNominatimJson(url, signal, headers) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (controller.signal.aborted) throw new Error("Nominatim timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function reverseGeocode(lat, lng, signal) {
  const key = `${lat},${lng}`;
  const cached = reverseGeocodeCache.get(key);
  if (cached && Date.now() - cached.createdAt < GEOCODER_CACHE_TTL_MS) {
    console.info("Nominatim reverse coordinates:", { lat, lng });
    console.info("Nominatim reverse response:", cached.rawResponse);
    return requireTamilNadu(cached.location);
  }

  await waitForNominatim(signal);
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");
  const publicUrl = appPublicUrl();
  const body = await fetchNominatimJson(url, signal, {
    // Switch to a hosted geocoder for higher-volume production traffic.
    "User-Agent": `PlatewiseSmartCompare/1.0 (${publicUrl})`,
    Referer: publicUrl
  });
  console.info("Nominatim reverse coordinates:", { lat, lng });
  console.info("Nominatim reverse response:", body);
  const location = locationFromNominatim(body, lat, lng);
  const result = { location, rawResponse: body, createdAt: Date.now() };
  cacheGeocoderResult(reverseGeocodeCache, key, result);
  return requireTamilNadu(location);
}

function normalizedLocationText(value) {
  return String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isWithinTamilNaduBounds(lat, lng) {
  return lat >= 8.0 && lat <= 13.6 && lng >= 76.2 && lng <= 80.4;
}

function mapNominatimResults(entries) {
  return entries.map((entry) => {
    const lat = Number.parseFloat(entry.lat);
    const lng = Number.parseFloat(entry.lon);
    const location = locationFromNominatim(entry, lat, lng);
    if (!location ||
      normalizedLocationText(location.state) !== "tamilnadu" ||
      normalizedLocationText(location.country) !== "india" ||
      !isWithinTamilNaduBounds(lat, lng)) return null;
    return { ...location, label: location.address, source: "manual" };
  }).filter(Boolean).slice(0, 5);
}

function appPublicUrl() {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/`;
  return "http://localhost:5173/";
}

async function searchNominatim(query, signal) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("q", query);
  url.searchParams.set("viewbox", TAMIL_NADU_VIEWBOX);
  url.searchParams.set("bounded", "1");
  const publicUrl = appPublicUrl();
  const body = await fetchNominatimJson(url, signal, {
    // Switch to a hosted geocoder for higher-volume production traffic.
    "User-Agent": `PlatewiseSmartCompare/1.0 (${publicUrl})`,
    Referer: publicUrl
  });
  console.info("Nominatim search query:", query);
  console.info("Nominatim search response:", body);
  return body;
}

async function suggestLocations(query, _bias = {}, signal) {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const key = normalizedQuery.toLocaleLowerCase();
  const cached = locationSuggestionCache.get(key);
  if (cached && Date.now() - cached.createdAt < GEOCODER_CACHE_TTL_MS) {
    console.info("Nominatim search query:", normalizedQuery);
    console.info("Nominatim search response:", cached.rawResponse);
    return cached.result;
  }

  await waitForNominatim(signal);
  const rawResponse = await searchNominatim(normalizedQuery, signal);
  const locations = mapNominatimResults(rawResponse);
  const result = { locations, fallback: false, originalQuery: normalizedQuery };
  cacheGeocoderResult(locationSuggestionCache, key, { createdAt: Date.now(), result, rawResponse });
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
          sendJson(response, error.code === "OUTSIDE_TAMIL_NADU" ? 422 : 502, {
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
