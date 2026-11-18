const GOOGLE_MAPS_CALLBACK = "__platewiseGoogleMapsReady";
const TAMIL_NADU_BOUNDS = { north: 13.6, south: 8, east: 80.4, west: 76.2 };
let googleMapsPromise;

function googleMapsApiKey() {
  return String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
}

export function hasGoogleMapsApiKey() {
  return googleMapsApiKey().length > 0;
}

export function googleStatusMessage(status) {
  const messages = {
    REQUEST_DENIED: "Google denied this request. Check billing, Maps JavaScript API, Geocoding API, Places API, and your key's API/referrer restrictions.",
    ZERO_RESULTS: "Google found no matching address. Try a nearby area or pincode.",
    OVER_QUERY_LIMIT: "Google Maps quota was exceeded. Check your billing and API quotas.",
    OVER_DAILY_LIMIT: "Google Maps daily quota or billing limit was reached.",
    INVALID_REQUEST: "Google Maps received an invalid location request. Select the place again.",
    UNKNOWN_ERROR: "Google Maps had a temporary error. Please retry.",
    ERROR: "Google Maps could not contact its servers. Check your internet connection and retry."
  };
  const message = messages[status] || `Google Maps request failed (${status || "UNKNOWN_STATUS"}). Check the API key, enabled APIs, billing, and referrer restrictions.`;
  const error = new Error(message);
  error.code = status || "UNKNOWN_STATUS";
  return error;
}

export function loadGoogleMapsApi() {
  if (window.google?.maps?.Map && window.google.maps.places) {
    return Promise.resolve(window.google.maps);
  }
  const apiKey = googleMapsApiKey();
  if (!apiKey) {
    const error = new Error("Google Maps is not configured. Set VITE_GOOGLE_MAPS_API_KEY; OpenStreetMap fallback remains available.");
    error.code = "MISSING_API_KEY";
    return Promise.reject(error);
  }
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector("script[data-platewise-google-maps]");
    const script = existingScript || document.createElement("script");
    const previousAuthFailure = window.gm_authFailure;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      console.error("Google Maps authentication/loading error:", error.code, error.message);
      reject(error);
    };

    window.gm_authFailure = () => {
      const error = googleStatusMessage("REQUEST_DENIED");
      error.code = "gm_authFailure";
      fail(error);
      previousAuthFailure?.();
    };
    window[GOOGLE_MAPS_CALLBACK] = () => {
      if (settled) return;
      if (!window.google?.maps?.Map || !window.google.maps.places) {
        fail(googleStatusMessage("REQUEST_DENIED"));
        return;
      }
      settled = true;
      delete window[GOOGLE_MAPS_CALLBACK];
      resolve(window.google.maps);
    };

    if (!existingScript) {
      script.dataset.platewiseGoogleMaps = "true";
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly&loading=async&callback=${GOOGLE_MAPS_CALLBACK}`;
      script.onerror = () => {
        const error = new Error("Google Maps JavaScript API failed to load. Check the key, enabled APIs, billing, and localhost/vercel.app HTTP referrer restrictions.");
        error.code = "SCRIPT_LOAD_ERROR";
        fail(error);
      };
      document.head.appendChild(script);
    }
  }).catch((error) => {
    googleMapsPromise = null;
    throw error;
  });

  return googleMapsPromise;
}

function addressComponent(components, ...types) {
  const component = components.find((entry) => types.some((type) => entry.types.includes(type)));
  return component?.long_name || "";
}

function locationFromGoogleResult(result, lat, lng) {
  const components = result.address_components || [];
  const city = addressComponent(components, "locality", "postal_town", "sublocality_level_1");
  const district = addressComponent(components, "administrative_area_level_2");
  const area = addressComponent(
    components,
    "neighborhood",
    "sublocality_level_1",
    "sublocality",
    "administrative_area_level_3"
  ) || city || district;
  const address = String(result.formatted_address || "").trim();
  const point = result.geometry?.location;
  const resolvedLat = Number.isFinite(lat) ? lat : point?.lat?.();
  const resolvedLng = Number.isFinite(lng) ? lng : point?.lng?.();
  if (!address || !Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLng)) {
    throw new Error("Google returned an address without usable coordinates. Choose another result.");
  }
  return {
    lat: resolvedLat,
    lng: resolvedLng,
    address,
    label: address,
    area,
    city: city || district,
    district,
    pincode: addressComponent(components, "postal_code"),
    state: addressComponent(components, "administrative_area_level_1"),
    country: addressComponent(components, "country"),
    source: "manual"
  };
}

export async function reverseGeocodeGoogle(lat, lng) {
  const maps = await loadGoogleMapsApi();
  return new Promise((resolve, reject) => {
    new maps.Geocoder().geocode(
      { location: { lat: Number(lat), lng: Number(lng) } },
      (results, status) => {
        console.info("Google reverse geocode status:", status);
        if (status !== maps.GeocoderStatus.OK || !results?.[0]) {
          const error = googleStatusMessage(status);
          console.error("Google reverse geocode failed:", status, error.message);
          reject(error);
          return;
        }
        try {
          resolve(locationFromGoogleResult(results[0], Number(lat), Number(lng)));
        } catch (error) {
          console.error("Google reverse geocode result was unusable:", error.message);
          reject(error);
        }
      }
    );
  });
}

export async function searchGooglePlaces(query) {
  const maps = await loadGoogleMapsApi();
  return new Promise((resolve, reject) => {
    const service = new maps.places.AutocompleteService();
    const bounds = new maps.LatLngBounds(
      new maps.LatLng(TAMIL_NADU_BOUNDS.south, TAMIL_NADU_BOUNDS.west),
      new maps.LatLng(TAMIL_NADU_BOUNDS.north, TAMIL_NADU_BOUNDS.east)
    );
    service.getPlacePredictions({
      input: query,
      componentRestrictions: { country: "in" },
      bounds,
      strictBounds: true,
      types: ["geocode"]
    }, (predictions, status) => {
      console.info("Google Places autocomplete status:", status);
      if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([]);
        return;
      }
      if (status !== maps.places.PlacesServiceStatus.OK) {
        const error = googleStatusMessage(status);
        console.error("Google Places autocomplete failed:", status, error.message);
        reject(error);
        return;
      }
      resolve((predictions || []).map((prediction) => ({
        placeId: prediction.place_id,
        label: prediction.description,
        address: prediction.description,
        area: prediction.structured_formatting?.main_text || prediction.description,
        city: prediction.structured_formatting?.secondary_text || "",
        pincode: "",
        source: "manual"
      })));
    });
  });
}

export async function getGooglePlaceLocation(placeId) {
  const maps = await loadGoogleMapsApi();
  return new Promise((resolve, reject) => {
    const service = new maps.places.PlacesService(document.createElement("div"));
    service.getDetails({
      placeId,
      fields: ["address_components", "formatted_address", "geometry", "place_id"]
    }, (result, status) => {
      console.info("Google Places details status:", status);
      if (status !== maps.places.PlacesServiceStatus.OK || !result) {
        const error = googleStatusMessage(status);
        console.error("Google Places details failed:", status, error.message);
        reject(error);
        return;
      }
      try {
        resolve(locationFromGoogleResult(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}
