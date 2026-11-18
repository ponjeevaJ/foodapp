import React, { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { calculateFinalPrice } from "./domain/calculateFinalPrice.mjs";
import { applyBestCoupon } from "./domain/couponPricing.mjs";
import {
  openOrderWithFallback,
  orderActionLabel
} from "./domain/orderLinks.mjs";
import { cheapestOption, savingsBetween } from "./domain/cheapest.mjs";
import couponData from "./data/coupons.sample.json";
import LocationMapPicker from "./LocationMapPicker.jsx";

const PRIORITIES = ["Best overall", "Cheapest", "Fastest", "Best rated"];
const POPULAR_DISHES = [
  "Chicken Dum Biryani",
  "Paneer Dum Biryani",
  "Masala Dosa",
  "Chicken 65",
  "Parotta",
  "Butter Chicken",
  "Idli Sambar",
  "Veg Fried Rice"
];
const RECENT_SEARCH_KEY = "platewise.recentSearches";
const LAST_LOCATION_KEY = "platewise.lastLocation";
const MAP_FALLBACK_CENTER = { lat: 0, lng: 0 };
const WEIGHTS = {
  "Best overall": { price: 40, rating: 25, delivery: 20, reliability: 10, distance: 5 },
  Cheapest: { price: 70, rating: 10, delivery: 10, reliability: 5, distance: 5 },
  Fastest: { price: 20, rating: 15, delivery: 50, reliability: 10, distance: 5 },
  "Best rated": { price: 20, rating: 50, delivery: 15, reliability: 10, distance: 5 }
};

function Icon({ name, size = 18, className = "" }) {
  const paths = {
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m7 10 5 5 5-5" />,
    basket: <><path d="m5 9 2 11h10l2-11H5Z" /><path d="m9 9 3-6 3 6M9 13v3m6-3v3" /></>,
    alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4m0 3h.01" /></>
  };
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function money(value) {
  return `₹${Number(value || 0).toFixed(2).replace(/\.00$/, "")}`;
}

function cleanFoodInput(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 60);
}

function readRecentSearches() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]");
    return Array.isArray(stored)
      ? stored.filter((item) => typeof item === "string").slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

function readSavedLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "null");
    if (saved && typeof saved.label === "string" && saved.label.trim() &&
      typeof saved.area === "string" && saved.area.trim() &&
      typeof saved.city === "string" && saved.city.trim() &&
      typeof saved.country === "string" && saved.country.trim() &&
      typeof saved.pincode === "string" && ["gps", "manual"].includes(saved.source) &&
      Number.isFinite(saved.lat) && Number.isFinite(saved.lng) &&
      saved.lat >= -90 && saved.lat <= 90 && saved.lng >= -180 && saved.lng <= 180) {
      return {
        ...saved,
        address: saved.address || saved.label,
        accuracyMeters: Number.isFinite(saved.accuracyMeters) ? saved.accuracyMeters : null
      };
    }
  } catch {
    return null;
  }
  return null;
}

function locationQuery(location) {
  if (!location) return "";
  if (location.address || location.label) return location.address || location.label;
  const place = [location.area, location.city].filter(Boolean).join(", ");
  return location.pincode ? `${place} ${location.pincode}` : place;
}

function formatCoordinates(location) {
  return `${Number(location.lat).toFixed(5)}, ${Number(location.lng).toFixed(5)}`;
}

function locationConfirmationText(location) {
  const pincode = location.pincode ? ` ${location.pincode}` : "";
  return `Selected: ${location.area}, ${location.city}${pincode}`;
}

function addressNotFoundMessage(coordinates) {
  return `Address not found. Drag the pin or type your area (${formatCoordinates(coordinates)})`;
}

async function fetchReverseGeocode(lat, lng, signal) {
  const requestUrl = `/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
  console.info("Reverse geocode coordinates:", { lat, lng });
  try {
    const response = await fetch(requestUrl, { signal });
    const body = await response.json();
    console.info("Reverse geocode response:", { lat, lng, body });
    if (!response.ok || body.addressFound === false) {
      console.error("Reverse geocoding failed:", { lat, lng, status: response.status, body });
    }
    return { response, body };
  } catch (error) {
    console.error("Reverse geocoding request failed:", { lat, lng, error });
    throw error;
  }
}

function rerank(options, priority) {
  const weights = WEIGHTS[priority];
  return [...options].map((option) => ({
    ...option,
    score: Number(Object.entries(weights)
      .reduce((sum, [key, weight]) => sum + (option.scoreBreakdown?.[key] || 0) * weight / 100, 0)
      .toFixed(2))
  })).sort((a, b) =>
    calculateFinalPrice(a) - calculateFinalPrice(b) ||
    Number(b.rating) - Number(a.rating) ||
    Number(a.etaMinutes) - Number(b.etaMinutes)
  );
}

function getBadges(options) {
  if (!options.length) return {};
  const min = (key, value = (item) => Number(item[key])) => options.reduce((best, item) =>
    value(item) < value(best) ? item : best
  );
  const max = (key) => options.reduce((best, item) => item[key] > best[key] ? item : best);
  const value = options.reduce((best, item) =>
    item.score / Math.max(calculateFinalPrice(item), 1) >
      best.score / Math.max(calculateFinalPrice(best), 1) ? item : best
  );
  return {
    cheapest: min("finalTotal", calculateFinalPrice).provider,
    fastest: min("etaMinutes").provider,
    highestRated: max("rating").provider,
    bestValue: value.provider
  };
}

function PriceBreakdown({ option }) {
  return (
    <details className="price-details">
      <summary>
        <span>Price breakdown</span>
        <Icon name="chevron" size={16} />
      </summary>
      <div className="breakdown-list">
        <div><span>Dish price</span><strong>{money(option.itemPrice)}</strong></div>
        <div><span>Delivery fee</span><strong>{money(option.deliveryFee)}</strong></div>
        <div><span>Platform fee</span><strong>{money(option.platformFee)}</strong></div>
        <div><span>Packaging</span><strong>{money(option.packagingFee)}</strong></div>
        <div><span>GST</span><strong>{money(option.gst)}</strong></div>
        {option.discount > 0 && (
          <div className="discount-row">
            <span>Offer{option.couponCode ? ` · ${option.couponCode}` : ""}</span>
            <strong>−{money(option.discount)}</strong>
          </div>
        )}
        <div className="breakdown-total"><span>Total</span><strong>{money(calculateFinalPrice(option))}</strong></div>
      </div>
    </details>
  );
}

function CouponPrice({ option }) {
  return (
    <div className="coupon-price">
      <div className="app-total-line">
        <span>Original total</span>
        {option.couponApplied
          ? <s>{money(option.originalTotal)}</s>
          : <strong>{money(option.originalTotal)}</strong>}
      </div>
      {option.couponApplied ? (
        <>
          <div className="coupon-detail">
            <strong>{option.couponCode} · {option.couponTitle}</strong>
            {option.couponIsSampleData && <span className="sample-badge">Sample data</span>}
          </div>
          <div className="app-total-line">
            <span>Coupon savings</span>
            <strong>−{money(option.discountAmount)}</strong>
          </div>
          <details className="coupon-terms">
            <summary>View terms</summary>
            <p>{option.couponTerms}</p>
            <small>Expires {option.couponValidTo}</small>
          </details>
        </>
      ) : (
        <p className="no-coupon-note">
          {option.couponsEnabled ? "No coupon available" : "Coupons not applied"}
        </p>
      )}
      <div className="app-total-line coupon-final-total">
        <span>Final total</span>
        <strong>{money(option.finalTotal)}</strong>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-label="Loading comparison">
      <div className="skeleton h-44 rounded-[28px]" />
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((item) => <div className="skeleton h-52 rounded-3xl" key={item} />)}
      </div>
    </div>
  );
}

export default function App() {
  const savedLocation = readSavedLocation();
  const [location, setLocation] = useState(savedLocation);
  const [locationInput, setLocationInput] = useState(locationQuery(savedLocation));
  const [form, setForm] = useState({
    food: "Chicken Dum Biryani",
    shopName: "",
    veg: "non-veg",
    minPrice: "100",
    maxPrice: "600",
    minRating: "4",
    priority: "Best overall"
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchedFood, setSearchedFood] = useState("");
  const [foodMessage, setFoodMessage] = useState("");
  const [recentSearches, setRecentSearches] = useState(readRecentSearches);
  const [suggestions, setSuggestions] = useState(
    POPULAR_DISHES.map((dish) => ({ dish, source: "Popular" }))
  );
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [locationMessage, setLocationMessage] = useState(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationSearching, setLocationSearching] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationSuggestionsOpen, setLocationSuggestionsOpen] = useState(false);
  const [locationSearchRetry, setLocationSearchRetry] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapSelectionLocation, setMapSelectionLocation] = useState(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [targetPrice, setTargetPrice] = useState("");
  const [groupSize, setGroupSize] = useState(2);
  const [applyCoupons, setApplyCoupons] = useState(true);
  const [includeFirstOrderCoupons, setIncludeFirstOrderCoupons] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [orderChoice, setOrderChoice] = useState(null);
  const [orderError, setOrderError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const compareController = useRef(null);
  const suggestionController = useRef(null);
  const locationSuggestionController = useRef(null);
  const locationConfirmController = useRef(null);
  const locationOperationRef = useRef(0);
  const locationInputRef = useRef(null);
  const lastSearchRef = useRef(null);
  const locationBiasRef = useRef(savedLocation
    ? { city: savedLocation.city, lat: savedLocation.lat, lng: savedLocation.lng }
    : { city: "", lat: NaN, lng: NaN });

  const rankedGroups = useMemo(() => (result?.groups || []).map((group) => ({
    ...group,
    options: rerank(group.options.map((option) => applyBestCoupon(
      option,
      couponData.coupons,
      {
        applyCoupons,
        includeFirstOrder: includeFirstOrderCoupons,
        paymentMethod,
        stackingAllowedApps: couponData.stackingAllowedApps
      }
    )), form.priority)
  })).sort((left, right) =>
    (left.options[0]?.finalTotal ?? Infinity) - (right.options[0]?.finalTotal ?? Infinity)
  ), [result, form.priority, applyCoupons, includeFirstOrderCoupons, paymentMethod]);
  const rankedOptions = useMemo(() => rankedGroups
    .flatMap((group) => group.options)
    .sort((a, b) => calculateFinalPrice(a) - calculateFinalPrice(b)), [rankedGroups]);
  const winner = cheapestOption(rankedOptions);
  const winnerGroupOptions = rankedGroups.find((group) => group.options.includes(winner))?.options || [];
  const badges = getBadges(winnerGroupOptions);
  const savings = savingsBetween(rankedOptions);
  const liveIntelligence = useMemo(() => {
    if (!winner) return result?.intelligence || {};
    const allOptions = rankedGroups.flatMap((group) => group.options);
    const nearby = allOptions.filter((option) =>
      option.provider !== winner.provider &&
      option.portion === winner.portion &&
      option.foodType === winner.foodType &&
      calculateFinalPrice(option) < calculateFinalPrice(winner) &&
      option.distanceKm <= 5
    ).sort((a, b) => calculateFinalPrice(a) - calculateFinalPrice(b))[0];
    return {
      freeDeliveryTracker: winner.deliveryFee > 0 && winner.itemPrice < winner.freeDeliveryAbove
        ? {
            provider: winner.provider,
            addAmount: winner.freeDeliveryAbove - winner.itemPrice,
            threshold: winner.freeDeliveryAbove
          }
        : null,
      hiddenFeeAlert: (winner.deliveryFee + winner.platformFee + winner.packagingFee + winner.gst) >= winner.itemPrice * 0.25,
      peakHourWarning: winner.surgeFee >= 15
        ? `Peak-hour fee is ₹${winner.surgeFee}; consider ordering later.`
        : null,
      nearbyAlternative: nearby ? {
        provider: nearby.provider,
        restaurantName: nearby.restaurantName,
        dish: nearby.dish,
        finalTotal: calculateFinalPrice(nearby),
        distanceKm: nearby.distanceKm
      } : null,
      priceHistory: {
        average30d: winner.history30dAverage,
        difference: Number((winner.itemPrice - winner.history30dAverage).toFixed(2)),
        trend: winner.itemPrice > winner.history30dAverage
          ? "higher"
          : winner.itemPrice < winner.history30dAverage ? "lower" : "usual"
      },
      priceDropAlert: targetPrice === "" ? null : {
        targetPrice: Number(targetPrice),
        reached: calculateFinalPrice(winner) <= Number(targetPrice)
      },
      groupSplit: {
        groupSize: Number(groupSize),
        amountPerPerson: Number((calculateFinalPrice(winner) / Number(groupSize)).toFixed(2))
      }
    };
  }, [result, rankedGroups, winner, targetPrice, groupSize]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    if (!suggestionsOpen) return undefined;
    const controller = new AbortController();
    suggestionController.current?.abort();
    suggestionController.current = controller;
    const query = cleanFoodInput(form.food);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Suggestions could not be loaded.");
        const body = await response.json();
        if (controller.signal.aborted) return;

        const recent = recentSearches
          .filter((dish) => !query || dish.toLowerCase().includes(query.toLowerCase()))
          .map((dish) => ({ dish, source: "Recent" }));
        const remote = (body.suggestions || []).map((dish) => ({
          dish,
          source: POPULAR_DISHES.includes(dish) ? "Popular" : "Suggested"
        }));
        const merged = [...recent, ...remote];
        setSuggestions(merged.filter((item, index) =>
          merged.findIndex((other) => other.dish.toLowerCase() === item.dish.toLowerCase()) === index
        ).slice(0, 8));
      } catch (suggestionError) {
        if (suggestionError.name !== "AbortError") {
          setSuggestions(POPULAR_DISHES.slice(0, 8).map((dish) => ({ dish, source: "Popular" })));
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.food, recentSearches, suggestionsOpen]);

  useEffect(() => {
    const query = locationInput.trim();
    if (location || mapSelectionLocation || query.length < 3) {
      setLocationSuggestions([]);
      setLocationSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    locationSuggestionController.current?.abort();
    locationSuggestionController.current = controller;
    const timer = setTimeout(async () => {
      setLocationSearching(true);
      setLocationMessage({ type: "status", text: "Searching..." });
      try {
        const params = new URLSearchParams({ q: query });
        const bias = locationBiasRef.current;
        if (bias.city) params.set("city", bias.city);
        if (Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
          params.set("lat", String(bias.lat));
          params.set("lng", String(bias.lng));
        }
        const requestUrl = `/api/location-suggest?${params}`;
        const response = await fetch(requestUrl, {
          signal: controller.signal
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Location suggestions could not be loaded.");
        if (!controller.signal.aborted) {
          const matches = (body.locations || []).slice(0, 6);
          setLocationSuggestions(matches);
          setLocationSuggestionsOpen(true);
          if (!matches.length) {
            setLocationMessage({
              type: "error",
              text: `No places found for '${query}'. Try the area name or pincode.`
            });
          } else if (body.fallback) {
            setLocationMessage({
              type: "status",
              text: `Showing nearby matches for ${body.originalQuery || query}.`
            });
          } else {
            setLocationMessage({ type: "status", text: "Choose the correct location from the suggestions." });
          }
        }
      } catch (suggestionError) {
        if (suggestionError.name !== "AbortError" && !controller.signal.aborted) {
          setLocationSuggestions([]);
          setLocationMessage({
            type: "error",
            retryable: true,
            text: "Location service unavailable. Check your internet and try again"
          });
        }
      } finally {
        if (locationSuggestionController.current === controller) setLocationSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [locationInput, location, mapSelectionLocation, locationSearchRetry]);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(recentSearches.slice(0, 10)));
    } catch {
      setFoodMessage("Recent searches could not be saved in this browser.");
    }
  }, [recentSearches]);

  async function compare(event, submittedForm = form) {
    event?.preventDefault();
    const food = cleanFoodInput(submittedForm.food);
    if (food.length < 2) {
      setFoodMessage("Enter at least 2 characters for a dish.");
      setSuggestionsOpen(true);
      return;
    }
    if (!location ||
      !Number.isFinite(Number(location.lat)) ||
      !Number.isFinite(Number(location.lng)) ||
      Number(location.lat) < -90 || Number(location.lat) > 90 ||
      Number(location.lng) < -180 || Number(location.lng) > 180 ||
      !location.label || !location.address || !location.area || !location.city || !location.country ||
      !["gps", "manual"].includes(location.source)) {
      setLocationMessage({
        type: "error",
        text: "Please choose your location."
      });
      locationInputRef.current?.focus();
      return;
    }

    const searchForm = { ...submittedForm, food };
    lastSearchRef.current = searchForm;
    setForm(searchForm);
    setFoodMessage("");
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    compareController.current?.abort();
    const controller = new AbortController();
    compareController.current = controller;
    setLoading(true);
    setError("");
    setSearched(false);
    setResult(null);
    try {
      const params = new URLSearchParams({
        food,
        veg: searchForm.veg,
        minPrice: searchForm.minPrice || "0",
        maxPrice: searchForm.maxPrice || "100000",
        minRating: searchForm.minRating || "0",
        priority: searchForm.priority,
        groupSize: String(groupSize),
        radiusKm: String(radiusKm)
      });
      if (searchForm.shopName.trim()) params.set("shopName", searchForm.shopName.trim());
      if (targetPrice !== "") params.set("targetPrice", targetPrice);
      params.set("lat", String(location.lat));
      params.set("lng", String(location.lng));
      params.set("label", location.label);
      params.set("address", location.address || location.label);
      params.set("area", location.area);
      params.set("city", location.city);
      params.set("country", location.country);
      params.set("pincode", location.pincode || "");
      params.set("source", location.source);
      if (Number.isFinite(location.accuracyMeters)) {
        params.set("accuracyMeters", String(location.accuracyMeters));
      }
      const response = await fetch(`/api/compare?${params}`, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "We couldn't compare these options.");
      if (controller.signal.aborted) return;
      setResult(body);
      setSearched(true);
      setSearchedFood(food);
      setRecentSearches((current) => [
        food,
        ...current.filter((item) => item.toLowerCase() !== food.toLowerCase())
      ].slice(0, 10));
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        if (import.meta.env.DEV) console.error("comparison request failed:", requestError);
        setError(requestError.message || "Something went wrong. Please try again.");
      }
    } finally {
      if (compareController.current === controller) setLoading(false);
    }
  }

  function changeFood(value) {
    const food = value.slice(0, 60);
    update("food", food);
    setFoodMessage(food.trim().length === 1 ? "Enter at least 2 characters for a dish." : "");
    setSuggestionsOpen(true);
    setActiveSuggestion(-1);
    setResult(null);
    setSearched(false);
    setError("");
    lastSearchRef.current = null;
    compareController.current?.abort();
    setLoading(false);
  }

  function saveLocation(nextLocation, message) {
    locationOperationRef.current += 1;
    locationConfirmController.current?.abort();
    const savedLocation = {
      ...nextLocation,
      lat: Number(nextLocation.lat),
      lng: Number(nextLocation.lng),
      address: String(nextLocation.address || nextLocation.label || ""),
      label: String(nextLocation.address || nextLocation.label || ""),
      pincode: String(nextLocation.pincode || ""),
      accuracyMeters: typeof nextLocation.accuracyMeters === "number" &&
        Number.isFinite(nextLocation.accuracyMeters)
        ? Number(nextLocation.accuracyMeters)
        : null
    };
    compareController.current?.abort();
    setResult(null);
    setSearched(false);
    setLoading(false);
    setError("");
    locationBiasRef.current = {
      city: savedLocation.city || "",
      lat: savedLocation.lat,
      lng: savedLocation.lng
    };
    setLocation(savedLocation);
    setLocationInput(locationQuery(savedLocation));
    setLocationSuggestions([]);
    setLocationSuggestionsOpen(false);
    try {
      localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(savedLocation));
      setLocationMessage({ type: "status", text: message });
    } catch {
      setLocationMessage({
        type: "error",
        text: "Location is selected for this session, but could not be saved in this browser."
      });
    }
  }

  function clearLocationSelection(nextInput = "") {
    locationOperationRef.current += 1;
    locationConfirmController.current?.abort();
    compareController.current?.abort();
    setLocation(null);
    setLocationInput(nextInput);
    setLocationSuggestions([]);
    setLocationSuggestionsOpen(false);
    setResult(null);
    setSearched(false);
    setLoading(false);
    try {
      localStorage.removeItem(LAST_LOCATION_KEY);
    } catch {
      setLocationMessage({ type: "error", text: "The saved location could not be cleared." });
    }
  }

  async function useCurrentLocation() {
    if (!window.isSecureContext) {
      console.error("Current location requires a secure context.");
      setLocationMessage({
        type: "error",
        text: "Location needs HTTPS or localhost. On your phone, open this app through an HTTPS tunnel such as ngrok or configure Vite for HTTPS."
      });
      return;
    }
    if (!navigator.geolocation) {
      console.error("Current location is unavailable: geolocation is not supported.");
      setLocationMessage({
        type: "error",
        text: "This browser does not support location. Enter a city or address and choose a suggestion instead."
      });
      return;
    }

    const operationId = ++locationOperationRef.current;
    setLocationBusy(true);
    locationConfirmController.current?.abort();
    setLocationMessage({ type: "status", text: "Finding your current location…" });
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        });
      });
      if (operationId !== locationOperationRef.current) return;
      const coordinates = {
        lat: Number(position.coords.latitude),
        lng: Number(position.coords.longitude)
      };
      const accuracyMeters = Number(position.coords.accuracy);
      if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
        throw new Error("The browser returned invalid accuracy. Choose a place manually.");
      }
      setMapCenter(coordinates);
      setMapOpen(true);
      await pickMapLocation(coordinates, { source: "gps", accuracyMeters });
    } catch (locationError) {
      if (operationId !== locationOperationRef.current) return;
      console.error("Current location request failed:", locationError);
      const messages = {
        1: "Location permission was denied. Enable it in your browser or phone settings, or enter a location manually.",
        2: "Your position is unavailable right now. Check device location services and retry, or enter a location manually.",
        3: "Finding your location timed out. Retry, or enter a location manually."
      };
      setLocationMessage({
        type: "error",
        help: locationError.code === 1,
        text: messages[locationError.code] || locationError.message || "We couldn't get your location. Retry, or enter a location manually."
      });
    } finally {
      if (operationId === locationOperationRef.current) setLocationBusy(false);
    }
  }

  async function openMapPicker() {
    const operationId = ++locationOperationRef.current;
    locationConfirmController.current?.abort();
    if (location) {
      const point = { lat: Number(location.lat), lng: Number(location.lng) };
      setMapCenter(point);
      setMapSelectionLocation(location);
      setMapOpen(true);
      setLocationMessage({ type: "status", text: "Drag the pin or choose a point, then confirm." });
      return;
    }
    if (operationId !== locationOperationRef.current) return;
    setMapCenter(MAP_FALLBACK_CENTER);
    setMapSelectionLocation(null);
    setMapOpen(true);
    setLocationMessage({
      type: "status",
      text: "Choose a point on the map, or search for an area or pincode."
    });
  }

  async function pickMapLocation(point, metadata = {}) {
    const operationId = ++locationOperationRef.current;
    const coordinates = { lat: Number(point.lat), lng: Number(point.lng) };
    if (!Number.isFinite(coordinates.lat) || coordinates.lat < -90 || coordinates.lat > 90 ||
      !Number.isFinite(coordinates.lng) || coordinates.lng < -180 || coordinates.lng > 180) {
      setLocationMessage({ type: "error", text: "The map returned invalid coordinates. Choose another point." });
      return;
    }
    setMapCenter(coordinates);
    setMapSelectionLocation({
      ...coordinates,
      address: "",
      city: "",
      pincode: "",
      source: metadata.source || "manual",
      accuracyMeters: typeof metadata.accuracyMeters === "number" &&
        Number.isFinite(metadata.accuracyMeters)
        ? Number(metadata.accuracyMeters)
        : null
    });
    setLocationInput("");
    setLocationBusy(true);
    setLocationMessage({ type: "status", text: "Looking up the selected map point..." });
    const controller = new AbortController();
    locationConfirmController.current?.abort();
    locationConfirmController.current = controller;
    try {
      const { response, body } = await fetchReverseGeocode(
        coordinates.lat,
        coordinates.lng,
        controller.signal
      );
      if (operationId !== locationOperationRef.current) return;
      if (controller.signal.aborted) return;
      if (!response.ok || body.addressFound === false || !body.location?.area ||
        !body.location?.city || !body.location?.country) {
        setLocationMessage({ type: "error", text: addressNotFoundMessage(coordinates) });
        return;
      }
      if (String(body.location.country).toLocaleLowerCase() !== "india") {
        throw new Error("Choose a map point in India.");
      }
      const selectedLocation = {
        ...body.location,
        address: String(body.location.address || body.location.label || body.address || ""),
        label: String(body.location.address || body.location.label || body.address || ""),
        ...coordinates,
        source: metadata.source || "manual",
        accuracyMeters: typeof metadata.accuracyMeters === "number" &&
          Number.isFinite(metadata.accuracyMeters)
          ? Number(metadata.accuracyMeters)
          : null
      };
      if (!selectedLocation.address) {
        setLocationMessage({ type: "error", text: addressNotFoundMessage(coordinates) });
        return;
      }
      setMapSelectionLocation(selectedLocation);
      setLocationInput(selectedLocation.address);
      if (Number(metadata.accuracyMeters) > 500) {
        setLocationMessage({
          type: "error",
          text: `Location accuracy is low (about ${Math.round(metadata.accuracyMeters)} m). Drag the pin on the map to correct it`
        });
      } else {
        setLocationMessage({ type: "status", text: locationConfirmationText(selectedLocation) });
      }
    } catch (mapError) {
      if (operationId === locationOperationRef.current && mapError.name !== "AbortError") {
        setLocationMessage({
          type: "error",
          text: addressNotFoundMessage(coordinates)
        });
      }
    } finally {
      if (locationConfirmController.current === controller &&
        operationId === locationOperationRef.current) setLocationBusy(false);
    }
  }

  function confirmMapLocation() {
    if (!mapSelectionLocation?.address) {
      setLocationMessage({
        type: "error",
        text: "No address is available to confirm. Pick another point or search for an address."
      });
      return;
    }
    saveLocation(
      mapSelectionLocation,
      `Location confirmed: ${mapSelectionLocation.label}`
    );
    setMapOpen(false);
    setMapSelectionLocation(null);
  }

  function closeMapPicker() {
    locationOperationRef.current += 1;
    locationConfirmController.current?.abort();
    setMapOpen(false);
    setMapSelectionLocation(null);
    setMapCenter(location
      ? { lat: Number(location.lat), lng: Number(location.lng) }
      : MAP_FALLBACK_CENTER);
    setLocationInput(locationQuery(location));
    setLocationBusy(false);
  }

  function changeLocation() {
    clearLocationSelection();
    setLocationMessage({
      type: "status",
      text: "Enter an area, street, landmark, or 6-digit pincode, then choose a suggestion."
    });
    locationInputRef.current?.focus();
  }

  async function selectLocation(suggestion) {
    if (!Number.isFinite(Number(suggestion.lat)) || Number(suggestion.lat) < -90 ||
      Number(suggestion.lat) > 90 || !Number.isFinite(Number(suggestion.lng)) ||
      Number(suggestion.lng) < -180 || Number(suggestion.lng) > 180 ||
      !suggestion.area || !suggestion.city || !suggestion.country || !suggestion.label) {
      setLocationMessage({ type: "error", text: "That location could not be selected. Choose another suggestion." });
      return;
    }
    const operationId = ++locationOperationRef.current;
    compareController.current?.abort();
    setResult(null);
    setSearched(false);
    setLoading(false);
    const coordinates = { lat: Number(suggestion.lat), lng: Number(suggestion.lng) };
    const suggestionAddress = String(suggestion.address || suggestion.label);
    const suggestionLocation = {
      ...suggestion,
      ...coordinates,
      address: suggestionAddress,
      label: suggestionAddress,
      source: "manual",
      accuracyMeters: null
    };
    setMapCenter(coordinates);
    setMapSelectionLocation(suggestionLocation);
    setMapOpen(true);
    setLocationInput(suggestionAddress);
    setLocationSuggestions([]);
    setLocationSuggestionsOpen(false);
    setLocationBusy(true);
    setLocationMessage({ type: "status", text: "Verifying the selected location…" });
    const controller = new AbortController();
    locationConfirmController.current?.abort();
    locationConfirmController.current = controller;
    try {
      const { response, body } = await fetchReverseGeocode(
        Number(suggestion.lat),
        Number(suggestion.lng),
        controller.signal
      );
      if (operationId !== locationOperationRef.current) return;
      if (controller.signal.aborted) return;
      if (!response.ok || body.addressFound === false || !body.location) {
        setLocationMessage({
          type: "error",
          text: body.error || addressNotFoundMessage(coordinates)
        });
        return;
      }
      const verified = body.location;
      const normalize = (value) => String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!verified?.city || !verified?.country ||
        normalize(verified.city) !== normalize(suggestion.city) ||
        normalize(verified.country) !== normalize(suggestion.country)) {
        setMapSelectionLocation({ ...suggestionLocation, address: "", label: "" });
        setLocationInput("");
        throw new Error("That point does not resolve inside the selected city and country. Choose another suggestion.");
      }
      const selectedLocation = {
        ...verified,
        address: String(verified.address || verified.label || body.address || suggestionAddress),
        label: String(verified.address || verified.label || body.address || suggestionAddress),
        pincode: verified.pincode || suggestion.pincode || "",
        ...coordinates,
        source: "manual",
        accuracyMeters: null
      };
      setMapCenter(coordinates);
      setMapSelectionLocation(selectedLocation);
      setLocationInput(selectedLocation.address);
      setLocationMessage({ type: "status", text: locationConfirmationText(selectedLocation) });
    } catch (verificationError) {
      if (operationId === locationOperationRef.current && verificationError.name !== "AbortError") {
        console.error("Location suggestion verification failed:", verificationError);
        setLocationMessage({
          type: "error",
          text: verificationError.message || "The selected location could not be verified. Choose another suggestion."
        });
      }
    } finally {
      if (locationConfirmController.current === controller &&
        operationId === locationOperationRef.current) setLocationBusy(false);
    }
  }

  useEffect(() => {
    if (location && lastSearchRef.current) {
      compare(undefined, lastSearchRef.current);
    }
  }, [location, radiusKm]);

  function selectSuggestion(dish) {
    compare(undefined, { ...form, food: dish });
  }

  function openOrder(option) {
    setOrderChoice(option);
    setOrderError("");
    setCopyMessage("");
  }

  function openOrderChoice() {
    if (!orderChoice) return;
    const outcome = openOrderWithFallback(orderChoice, location, (url) => {
      const popup = window.open(url, "_blank");
      if (!popup) return false;
      popup.opener = null;
      return popup;
    });
    if (!outcome.opened) {
      setOrderError(`Could not open ${orderChoice.app || orderChoice.provider}. ${outcome.failures.join(" ")}`);
      return;
    }
    setOrderChoice(null);
  }

  async function copyOrderValue(value, label) {
    if (!navigator.clipboard?.writeText) {
      setCopyMessage("Clipboard access is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied.`);
    } catch (error) {
      setCopyMessage(`Could not copy ${label}: ${error.message || "clipboard access was denied."}`);
    }
  }

  const bestReason = winner && rankedOptions.length > 1
    ? `${winner.shopName || winner.restaurantName} on ${winner.app || winner.provider} is the lowest priced nearby option; you save ${money(savings)} versus the highest total.`
    : winner ? `The only matching option available for ${winner.dish}.` : "";
  const addressInputValue = mapOpen
    ? mapSelectionLocation?.address || ""
    : location?.address || locationInput;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="site-header">
        <div className="page-shell flex h-[76px] items-center justify-between">
          <a className="brand" href="#" aria-label="Platewise home">
            <span className="brand-mark"><Icon name="basket" size={21} /></span>
            <span>platewise<span className="brand-period">.</span></span>
          </a>
          <div className="header-note"><span className="live-dot" /> Smarter choices, one plate at a time</div>
          <button className="profile-button" aria-label="Profile">A</button>
        </div>
      </header>

      <main className="page-shell pb-16">
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR FOOD, BETTER CHOSEN</div>
            <h1>One dish.<br /><span>Every good option.</span></h1>
            <p>We compare the real total, delivery time, and ratings—so you can order with confidence.</p>
            <div className="hero-proof">
              <span><Icon name="check" size={16} /> No hidden rankings</span>
              <span><Icon name="check" size={16} /> Your priorities, your call</span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-glow" />
            <div className="food-plate">
              <div className="plate-rim"><div className="plate-inner">
                <span className="food-leaf leaf-one" /><span className="food-leaf leaf-two" />
                <span className="food-piece piece-one" /><span className="food-piece piece-two" />
                <span className="food-piece piece-three" /><span className="food-rice rice-one" />
                <span className="food-rice rice-two" /><span className="food-tomato" />
              </div></div>
            </div>
            <div className="floating-tag"><span className="tag-spark"><Icon name="spark" size={15} /></span><span>Good food<br /><strong>great choice</strong></span></div>
            <div className="art-seed seed-one" /><div className="art-seed seed-two" />
          </div>
        </section>

        <form id="search-form" className="search-panel" onSubmit={compare}>
          <div className="search-heading">
            <div><span className="search-kicker">THE GOOD STUFF STARTS HERE</span><h2>What are you craving?</h2></div>
            <span className="secure-note"><Icon name="pin" size={15} /> Compare near you</span>
          </div>
          <div className="form-grid">
            <div className="field field-wide food-field">
              <label className="field-label" htmlFor="food-search">Dish or cuisine</label>
              <span className="input-wrap">
                <Icon name="search" size={18} />
                <input
                  id="food-search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestionsOpen}
                  aria-controls="food-suggestions"
                  aria-activedescendant={activeSuggestion >= 0 ? `food-option-${activeSuggestion}` : undefined}
                  autoComplete="off"
                  maxLength={60}
                  value={form.food}
                  onFocus={() => setSuggestionsOpen(true)}
                  onClick={() => setSuggestionsOpen(true)}
                  onChange={(event) => changeFood(event.target.value)}
                  onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && suggestions.length) {
                      event.preventDefault();
                      setSuggestionsOpen(true);
                      setActiveSuggestion((index) => Math.min(index + 1, suggestions.length - 1));
                    } else if (event.key === "ArrowUp" && suggestions.length) {
                      event.preventDefault();
                      setActiveSuggestion((index) => Math.max(index - 1, 0));
                    } else if (event.key === "Enter" && activeSuggestion >= 0) {
                      event.preventDefault();
                      selectSuggestion(suggestions[activeSuggestion].dish);
                    } else if (event.key === "Escape") {
                      setSuggestionsOpen(false);
                    }
                  }}
                  placeholder="Type any dish, e.g. masala dosa"
                  required
                />
              </span>
              {foodMessage && <span className="food-validation" role="status">{foodMessage}</span>}
              {suggestionsOpen && (
                <div className="suggestion-dropdown" id="food-suggestions" role="listbox" aria-label="Dish suggestions">
                  {recentSearches.length > 0 && (
                    <div className="suggestion-heading">
                      <span>Recent searches</span>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setRecentSearches([])}>Clear</button>
                    </div>
                  )}
                  {suggestions.map((suggestion, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={activeSuggestion === index}
                      id={`food-option-${index}`}
                      className="suggestion-option"
                      key={`${suggestion.source}-${suggestion.dish}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectSuggestion(suggestion.dish)}
                    >
                      <Icon name={suggestion.source === "Recent" ? "clock" : "search"} size={15} />
                      <span>{suggestion.dish}</span>
                      <small>{suggestion.source}</small>
                    </button>
                  ))}
                  {cleanFoodInput(form.food).length >= 2 && !suggestions.some(
                    (suggestion) => suggestion.dish.toLowerCase() === cleanFoodInput(form.food).toLowerCase()
                  ) && (
                    <button
                      type="button"
                      role="option"
                      className="suggestion-option custom-suggestion"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectSuggestion(cleanFoodInput(form.food))}
                    >
                      <Icon name="arrow" size={15} />
                      <span>Search for “{cleanFoodInput(form.food)}”</span>
                      <small>Any dish</small>
                    </button>
                  )}
                </div>
              )}
            </div>
            <label className="field field-shop-name" htmlFor="shop-name-filter">
              <span className="field-label">Optional shop name</span>
              <span className="input-wrap">
                <input
                  id="shop-name-filter"
                  value={form.shopName}
                  maxLength={120}
                  onChange={(event) => update("shopName", event.target.value)}
                  placeholder="Filter to a shop"
                />
              </span>
            </label>
            <div className="field field-location" aria-busy={locationSearching || locationBusy}>
              <label className="field-label" htmlFor="location-input">Your location <small>choose a suggestion</small></label>
              <span className="input-wrap"><Icon name="pin" size={18} /><input
                id="location-input"
                ref={locationInputRef}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={locationSuggestionsOpen}
                value={addressInputValue}
                onChange={(event) => {
                  clearLocationSelection(event.target.value);
                  setLocationMessage(null);
                  setLocationSuggestionsOpen(true);
                }}
                onFocus={() => setLocationSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setLocationSuggestionsOpen(false), 120)}
                placeholder={locationBusy
                  ? mapOpen ? "Looking up selected point…" : "Finding your location…"
                  : "Area, street, landmark, or pincode"}
              /></span>
              {locationSuggestionsOpen && locationSuggestions.length > 0 && (
                <div className="suggestion-dropdown location-suggestions" role="listbox" aria-label="Location suggestions">
                  {locationSuggestions.map((location) => (
                    <button
                      type="button"
                      role="option"
                      className="suggestion-option"
                      key={`${location.lat},${location.lng}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectLocation(location)}
                    >
                      <Icon name="pin" size={15} />
                      <span>{[location.area, location.city, location.pincode || location.country].filter(Boolean).join(", ")}</span>
                      <small>Select</small>
                    </button>
                  ))}
                </div>
              )}
              <div className="location-actions">
                <button className="text-button" type="button" onClick={useCurrentLocation} disabled={locationBusy}>
                  {locationBusy ? "Finding location…" : locationMessage?.type === "error" ? "Retry location" : "Use current location"}
                </button>
                <button className="plain-button" type="button" onClick={openMapPicker} disabled={locationBusy}>
                  Pick on map
                </button>
                {location && <button className="plain-button" type="button" onClick={changeLocation}>Change</button>}
              </div>
              {locationMessage && !mapOpen && (
                <div className={`location-message ${locationMessage.type === "error" ? "location-error" : ""}`} role="status">
                  <span>{locationMessage.text}</span>
                  {locationMessage.help && (
                    <ol>
                      <li>Open this site’s permissions from the browser address bar.</li>
                      <li>Set Location to Allow, then retry. On a phone, also enable device Location Services.</li>
                      <li>If permission stays blocked, change it in the browser or phone app settings and reload.</li>
                    </ol>
                  )}
                  {locationMessage.type === "error" && <span>Manual fallback: enter an area, street, landmark, or 6-digit pincode, then select a suggestion above.</span>}
                  {locationMessage.retryable && (
                    <button
                      className="plain-button"
                      type="button"
                      onClick={() => setLocationSearchRetry((attempt) => attempt + 1)}
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
            <label className="field">
              <span className="field-label">Food preference</span>
              <select value={form.veg} onChange={(event) => update("veg", event.target.value)}>
                <option value="both">Veg & non-veg</option><option value="veg">Vegetarian</option><option value="non-veg">Non-vegetarian</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Budget range <small>₹</small></span>
              <span className="range-input"><input aria-label="Minimum budget" type="number" min="0" value={form.minPrice} onChange={(event) => update("minPrice", event.target.value)} /><span>to</span><input aria-label="Maximum budget" type="number" min="0" value={form.maxPrice} onChange={(event) => update("maxPrice", event.target.value)} /></span>
            </label>
            <label className="field">
              <span className="field-label">Minimum rating</span>
              <select value={form.minRating} onChange={(event) => update("minRating", event.target.value)}>
                <option value="0">Any rating</option><option value="3.5">3.5+ stars</option><option value="4">4.0+ stars</option><option value="4.5">4.5+ stars</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Search radius <small>{radiusKm} km</small></span>
              <input
                aria-label="Search radius"
                type="range"
                min="1"
                max="20"
                step="1"
                value={radiusKm}
                onChange={(event) => setRadiusKm(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="search-actions">
            <div className="priority-control"><span>I'm in the mood for</span>{PRIORITIES.map((priority) => (
              <button className={`priority-pill ${form.priority === priority ? "active" : ""}`} type="button" key={priority} onClick={() => update("priority", priority)}>{priority === "Best overall" && <Icon name="spark" size={14} />}{priority}</button>
            ))}</div>
            <button type="submit" className="compare-button" disabled={loading}><span>{loading ? "Comparing" : "Find my best pick"}</span><Icon name="arrow" size={18} /></button>
          </div>
        </form>

        {mapOpen && mapCenter && (
          <div className="location-map-backdrop">
            <section className="location-map-dialog" role="dialog" aria-modal="true" aria-labelledby="map-picker-title">
              <div className="location-map-heading">
                <div>
                  <span className="section-overline">LOCATION FALLBACK</span>
                  <h2 id="map-picker-title">Pick on map</h2>
                  <p>Choose a point or drag the pin. Confirm after checking its address.</p>
                </div>
                <button className="plain-button" type="button" onClick={closeMapPicker}>Close</button>
              </div>
              <LocationMapPicker center={mapCenter} selectedPoint={mapSelectionLocation} onPick={pickMapLocation} />
              <div className="map-location-footer" aria-live="polite">
                <div className="map-location-footer-address" aria-busy={locationBusy}>
                  {mapSelectionLocation?.address
                    ? <p>{mapSelectionLocation.address}</p>
                    : <p>{locationBusy ? "Looking up the selected address…" : "Choose a point or search for an address."}</p>}
                  {mapSelectionLocation && (
                    <small className="location-coordinates">({formatCoordinates(mapSelectionLocation)})</small>
                  )}
                  {locationMessage?.type === "error" && (
                    <p className="map-location-error" role="alert">{locationMessage.text}</p>
                  )}
                </div>
                <button
                  className="compare-button map-confirm-button"
                  type="button"
                  disabled={locationBusy}
                  onClick={confirmMapLocation}
                >
                  {locationBusy && <span className="confirm-spinner" aria-hidden="true" />}
                  <span>OK / Confirm Location</span>
                </button>
              </div>
            </section>
          </div>
        )}

        {error && <div className="error-banner" role="alert"><Icon name="alert" /><span>{error}</span><button type="button" onClick={compare}>Try again</button></div>}

        {loading && <section className="results-section">
          {location && <p className="searching-near">Searching near: {location.area}, {location.city} ({formatCoordinates(location)})</p>}
          <div className="section-title"><span className="eyebrow-line" /><h2>Finding your best match</h2></div><Skeleton />
        </section>}

        {!loading && searched && !error && !winner && (
          <section className="empty-state">
            {location && <p className="searching-near">Searching near: {location.area}, {location.city} ({formatCoordinates(location)})</p>}
            <div className="empty-icon"><Icon name="search" size={25} /></div>
            <h2>No shop near {location?.area || "your selected area"} has '{searchedFood}'</h2>
            <p>Try a different spelling, or broaden your budget and rating filters.</p>
            <div className="similar-dishes">
              <span>Similar dishes</span>
              {(result?.didYouMean || suggestions.map((item) => item.dish))
                .filter((dish) => dish.toLowerCase() !== searchedFood.toLowerCase()).slice(0, 3).map((dish) => (
                <button type="button" key={dish} onClick={() => selectSuggestion(dish)}>{dish}</button>
              ))}
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                const widenedForm = {
                  ...form,
                  minPrice: "0",
                  maxPrice: String(Math.max(Number(form.maxPrice) * 2, 1000)),
                  minRating: "0"
                };
                compare(undefined, widenedForm);
              }}
            >
              Widen budget and rating <Icon name="arrow" size={16} />
            </button>
            <button className="plain-button" type="button" onClick={() => document.getElementById("search-form")?.scrollIntoView({ behavior: "smooth" })}>Try a different spelling</button>
          </section>
        )}

        {!loading && winner && (
          <section className="results-section" aria-live="polite">
            <p className="searching-near">Searching near: {location.area}, {location.city} ({formatCoordinates(location)})</p>
            <div className="section-title results-heading">
              <div><span className="eyebrow-line" /><span className="section-overline">YOUR COMPARISON</span><h2>Here’s the good stuff.</h2></div>
              <div className="result-count">{rankedGroups.length} shops · {rankedOptions.length} app offers · {result.comparison?.portion}</div>
            </div>

            <article className="winner-card">
              <div className="winner-main">
                <div className="winner-copy">
                  <div className="winner-label"><Icon name="spark" size={15} /> BEST PRICE FOR YOU</div>
                  <div className="winner-title-line"><h3>{winner.app || winner.provider}</h3><span className="choice-badge"><Icon name="check" size={14} /> Best Price</span></div>
                  <p>{winner.shopName || winner.restaurantName} <span className="dot-separator">·</span> {winner.itemName} {(winner.isSampleData || winner.isMock) && <span className="sample-badge">Sample data</span>}</p>
                  <div className="winner-meta">
                    <span><Icon name="star" size={15} className="star-icon" /> {winner.rating} <small>({winner.ratingCount.toLocaleString()})</small></span>
                    <span><Icon name="clock" size={15} /> {winner.etaMinutes} min</span>
                    <span><Icon name="pin" size={15} /> {winner.distanceKm} km</span>
                  </div>
                  <div className="winner-reason"><Icon name="spark" size={15} /> {bestReason}</div>
                </div>
                <div className="winner-total">
                  <span>Your total</span>
                  {winner.couponApplied && <s>{money(winner.originalTotal)}</s>}
                  <strong>{money(winner.finalTotal)}</strong>
                  {winner.couponApplied && (
                    <small>{winner.couponCode} applied{winner.couponIsSampleData ? " · Sample data" : ""}</small>
                  )}
                  <button type="button" onClick={() => openOrder(winner)} className="order-button">{orderActionLabel(winner)} <Icon name="arrow" size={17} /></button>
                </div>
              </div>
              <div className="winner-foot">
                <span><Icon name="check" size={15} /> You save {money(savings)} vs. the most expensive app</span>
                <span>Final price may vary slightly inside the app</span>
                <span>Updated {result.recommendation?.warnings?.[1]?.replace("Last updated ", "") || "just now"}</span>
              </div>
            </article>

            <div className="badge-row" aria-label="Comparison awards">
              <span className="badge-intro">ALSO WORTH KNOWING</span>
              <div className="award-chip"><span className="award-icon green">₹</span><span>Best Price<strong>{badges.cheapest}</strong></span></div>
              <div className="award-chip"><span className="award-icon blue"><Icon name="clock" size={15} /></span><span>Fastest<strong>{badges.fastest}</strong></span></div>
              <div className="award-chip"><span className="award-icon yellow"><Icon name="star" size={15} /></span><span>Highest rated<strong>{badges.highestRated}</strong></span></div>
              <div className="award-chip"><span className="award-icon lilac"><Icon name="spark" size={15} /></span><span>Best value<strong>{badges.bestValue}</strong></span></div>
            </div>

            <div className="comparison-heading"><div><span className="section-overline">SIDE BY SIDE</span><h2>Every detail, laid out.</h2></div><span className="sorted-note">Sorted by final price <Icon name="chevron" size={15} /></span></div>

            <section className="coupon-controls" aria-label="Coupon settings">
              <label>
                <input
                  type="checkbox"
                  checked={applyCoupons}
                  onChange={(event) => setApplyCoupons(event.target.checked)}
                />
                Apply coupons
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeFirstOrderCoupons}
                  onChange={(event) => setIncludeFirstOrderCoupons(event.target.checked)}
                />
                Include first-order offers
              </label>
              <label>
                Payment method
                <select
                  aria-label="Payment method"
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  <option value="">Any payment method</option>
                  <option value="UPI">UPI</option>
                  <option value="Card">Card</option>
                  <option value="Wallet">Wallet</option>
                  <option value="Cash">Cash</option>
                </select>
              </label>
              <p>Coupon prices are estimates. Offers can vary by account and payment method; confirm at checkout.</p>
              <span className="sample-badge">Coupon source: sample data</span>
            </section>

            {result.didYouMean?.length > 0 && (
              <div className="did-you-mean" role="status">
                <span>Did you mean?</span>
                {result.didYouMean.map((dish) => (
                  <button type="button" key={dish} onClick={() => selectSuggestion(dish)}>{dish}</button>
                ))}
              </div>
            )}

            <div className="shop-comparisons">
              {rankedGroups.map((group) => {
                const cheapestInShop = cheapestOption(group.options);
                const lowestTotal = calculateFinalPrice(cheapestInShop);
                const shopSavings = savingsBetween(group.options);
                return (
                  <section className="shop-comparison" key={`${group.restaurantName}-${group.dish}-${group.portion}`}>
                    <div className="shop-heading">
                      <div><h3>{group.restaurantName}</h3><span>{group.dish} · {group.portion}</span></div>
                      <strong>You save {money(shopSavings)} with the cheapest app</strong>
                    </div>
                    <div className="comparison-grid">
                      {group.options.map((option) => {
                        const isCheapest = option === cheapestInShop;
                        return (
                          <article className={`app-card ${isCheapest ? "app-card-best" : ""}`} key={`${option.app || option.provider}-${option.shopId}-${option.itemId}`}>
                            <div className="app-card-top">
                              <div className="provider-mark" data-provider={(option.app || option.provider).slice(0, 1)}>{(option.app || option.provider).slice(0, 1)}</div>
                              <div className="app-title"><strong>{option.app || option.provider}</strong><span>{option.shopName || option.restaurantName}</span></div>
                              <div className="card-tags">
                                {option.isMock && <span className="sample-badge">Sample data</span>}
                                {isCheapest && <span className="tiny-best"><Icon name="check" size={12} /> Cheapest</span>}
                              </div>
                            </div>
                            <div className="app-dish">{option.itemName}<small>{option.portion}</small></div>
                            {option.matchLabel && <small className="menu-match-label">{option.matchLabel}</small>}
                            <div className="app-stats">
                              <span><Icon name="star" size={14} className="star-icon" /> {option.rating}<small>({option.ratingCount.toLocaleString()})</small></span>
                              <span><Icon name="clock" size={14} /> {option.etaMinutes} min</span>
                              <span><Icon name="pin" size={14} /> {option.distanceKm} km</span>
                            </div>
                            <CouponPrice option={option} />
                            <div className="app-total-line"><span>Delivery fee</span><strong>{money(option.deliveryFee)}</strong></div>
                            <div className="app-total-line"><span>Taxes</span><strong>{money(option.gst)}</strong></div>
                            <PriceBreakdown option={option} />
                            <div className="score-line"><span>Match score</span><span>{option.score}<small>/100</small></span></div>
                            <button type="button" className={`card-order ${isCheapest ? "card-order-best" : ""}`} onClick={() => openOrder(option)}>{orderActionLabel(option)} <Icon name="arrow" size={15} /></button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            {result.unavailableProviders?.length > 0 && <p className="unavailable-note"><Icon name="alert" size={15} /> {result.unavailableProviders.join(", ")} unavailable right now. Other results are still shown.</p>}

            <section className="insights-section">
              <div className="insights-heading"><div><span className="section-overline">A LITTLE EXTRA INSIGHT</span><h2>Small details, smarter orders.</h2></div><Icon name="spark" size={21} /></div>
              <div className="insights-grid">
                <article className="insight-card">
                  <span className="insight-symbol delivery-symbol">↗</span><div><h3>Delivery tracker</h3><p>{liveIntelligence.freeDeliveryTracker ? `Add ${money(liveIntelligence.freeDeliveryTracker.addAmount)} more to reach ${winner.provider}’s free-delivery threshold.` : "You’ve reached the free-delivery threshold, or delivery is already free."}</p></div>
                </article>
                <article className={`insight-card ${liveIntelligence.hiddenFeeAlert ? "insight-alert" : ""}`}>
                  <span className="insight-symbol fee-symbol">{liveIntelligence.hiddenFeeAlert ? <Icon name="alert" size={17} /> : "₹"}</span><div><h3>{liveIntelligence.hiddenFeeAlert ? "Fees to keep in mind" : "Fees look balanced"}</h3><p>{liveIntelligence.hiddenFeeAlert ? "Delivery, platform, packaging and tax add up to a noticeable part of the dish price." : "No unusually high fees compared with the listed dish price."}</p></div>
                </article>
                <article className="insight-card">
                  <span className="insight-symbol history-symbol">⌁</span><div><h3>30-day price pulse</h3><p>Today’s dish price is {liveIntelligence.priceHistory?.trend || "at its usual level"}{liveIntelligence.priceHistory?.average30d ? ` · ${money(liveIntelligence.priceHistory.average30d)} average` : ""}.</p></div>
                </article>
                <article className="insight-card">
                  <span className="insight-symbol nearby-symbol"><Icon name="pin" size={17} /></span><div><h3>Nearby alternative</h3><p>{liveIntelligence.nearbyAlternative ? `${liveIntelligence.nearbyAlternative.dish} at ${liveIntelligence.nearbyAlternative.restaurantName} is ${money(liveIntelligence.nearbyAlternative.finalTotal)} nearby.` : "No cheaper like-for-like nearby alternative found."}</p></div>
                </article>
              </div>
              {liveIntelligence.peakHourWarning && <div className="surge-warning"><Icon name="alert" size={16} /> {liveIntelligence.peakHourWarning}</div>}
              <div className="tool-row">
                <label className="tool-input"><span>Alert me at</span><span className="rupee-input">₹<input aria-label="Price drop alert target" type="number" min="0" placeholder="Target price" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} /></span><span className="tool-status">{liveIntelligence.priceDropAlert?.reached ? "Target reached!" : targetPrice ? "Watching this price" : "Set a target"}</span></label>
                <label className="tool-input"><span>Split this order</span><span className="people-stepper"><button type="button" aria-label="Decrease group size" onClick={() => setGroupSize((count) => Math.max(1, count - 1))}>−</button><strong>{groupSize}</strong><button type="button" aria-label="Increase group size" onClick={() => setGroupSize((count) => Math.min(50, count + 1))}>+</button></span><span className="tool-status">{money(liveIntelligence.groupSplit?.amountPerPerson)} / person</span></label>
              </div>
            </section>
            {result.mismatches?.length > 0 && <div className="mismatch-note"><Icon name="alert" size={16} /><span><strong>Not compared:</strong> {result.mismatches.map((item) => `${item.dish} (${item.portion})`).join(", ")} — different dish or portion sizes.</span></div>}
            <p className="disclaimer">Prices and availability can change. Always confirm your order in the delivery app.</p>
          </section>
        )}
      </main>
      {orderChoice && (
        <div className="order-confirmation-backdrop">
          <section className="order-confirmation-sheet" role="dialog" aria-modal="true" aria-labelledby="order-confirmation-title">
            <div className="order-confirmation-heading">
              <div>
                <span className="section-overline">BEFORE YOU LEAVE</span>
                <h2 id="order-confirmation-title">Confirm your choice</h2>
              </div>
              <button type="button" className="plain-button" onClick={() => setOrderChoice(null)} aria-label="Close order confirmation">Close</button>
            </div>
            <p className="order-confirmation-choice">
              You chose: {orderChoice.itemName} from {orderChoice.shopName || orderChoice.restaurantName} on {orderChoice.app || orderChoice.provider} - {money(orderChoice.finalTotal ?? orderChoice.price ?? orderChoice.itemPrice)}
            </p>
            <p className="order-confirmation-delivery">
              Delivery to: {location.address || orderChoice.address || [location.area, location.city].filter(Boolean).join(", ")}
            </p>
            {(orderChoice.isSampleData || orderChoice.isMock) && (
              <p className="order-confirmation-sample">Sample data — this opens search results, not a confirmed order.</p>
            )}
            <p className="order-confirmation-hint">
              If {orderChoice.app || orderChoice.provider} shows different details, search for {orderChoice.shopName || orderChoice.restaurantName} and add {orderChoice.itemName}.
            </p>
            <div className="order-confirmation-actions">
              <button type="button" className="plain-button" onClick={() => copyOrderValue(orderChoice.shopName || orderChoice.restaurantName, "shop name")}>Copy shop name</button>
              <button type="button" className="plain-button" onClick={() => copyOrderValue(orderChoice.itemName, "item name")}>Copy item name</button>
              <button type="button" className="compare-button" onClick={openOrderChoice}>Open {orderChoice.app || orderChoice.provider}</button>
            </div>
            {(copyMessage || orderError) && <p className={orderError ? "order-confirmation-error" : "order-confirmation-status"} role="status">{orderError || copyMessage}</p>}
          </section>
        </div>
      )}
      <footer className="page-shell footer"><a className="brand footer-brand" href="#"><span className="brand-mark"><Icon name="basket" size={17} /></span><span>platewise<span className="brand-period">.</span></span></a><span>Better picks. Happier bites.</span><span>Made for the love of good food.</span></footer>
    </div>
  );
}
