import { afterEach, expect, test, vi } from "vitest";
import request from "supertest";
import { createServer as createHttpServer } from "node:http";
import serverModule from "../src/server.js";
import vercelApiHandler from "../api/[...path].js";
import sampleAdapter from "../src/adapters/mockAdapter.js";

const { createServer } = serverModule;
const { buildSampleShops, createMockAdapter } = sampleAdapter;
const servers = [];
const locationQuery = {
  lat: "45.5019",
  lng: "-73.5674",
  label: "Downtown, Montreal, Canada",
  area: "Downtown",
  city: "Montreal",
  country: "Canada",
  pincode: "",
  source: "manual"
};

function createTestApp(options) {
  const app = createServer(options);
  servers.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise((resolve) => server.close(resolve))
  ));
});

test("Vercel API entry point dispatches API routes", async () => {
  const app = createHttpServer(vercelApiHandler);
  servers.push(app);
  const response = await request(app).get("/api/suggest").query({ q: "bir" });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty("suggestions");
});

test("returns only sample menu items that match a UTF-8 food query", async () => {
  const response = await request(createTestApp({ logNoResults: vi.fn() }))
    .get("/api/compare")
    .query({
      food: "  Paneer   Butter Masala  ",
      ...locationQuery,
      veg: "veg"
    });

  expect(response.status).toBe(200);
  expect(response.body.results.every((item) => item.isMock)).toBe(true);
  expect(response.body.results.length).toBeGreaterThan(0);
  expect(response.body.results.every((item) => item.itemName === "Paneer Butter Masala")).toBe(true);
  expect(response.body.results.every((item) => item.lat > 45 && item.lng < -73)).toBe(true);
  expect(response.body.results.every((item) =>
    item.app && item.shopName && item.shopId && item.itemName && item.itemId &&
    item.price === item.itemPrice && item.appShopUrl === null &&
    item.appShopSlug === null && item.deepLink === null && item.webUrl === null &&
    item.searchUrl && item.area === "Downtown" && item.city === "Montreal" &&
    item.isSampleData === true
  )).toBe(true);
  const firstSearch = new URL(response.body.results[0].searchUrl);
  expect(firstSearch.searchParams.get("query")).toBe(
    `${response.body.results[0].shopName} Downtown Montreal`
  );
});

test("returns distinct nearby sample shops from each provider", async () => {
  const response = await request(createTestApp({ logNoResults: vi.fn() }))
    .get("/api/compare")
    .query({ food: "biryani", ...locationQuery });

  expect(response.status).toBe(200);
  expect(response.body.results.length).toBeGreaterThan(6);
  expect(new Set(response.body.results.map((item) => item.app))).toEqual(new Set(["Zomato", "Swiggy", "Toing"]));
  expect(new Set(response.body.results.map((item) => item.shopName)).size).toBeGreaterThan(3);
  expect(response.body.results.every((item) =>
    Number.isFinite(item.lat) && Number.isFinite(item.lng) &&
    item.distanceKm <= 5 && item.restaurantLocation.lat === item.lat &&
    item.restaurantLocation.lng === item.lng
  )).toBe(true);
});

test("provides at least fifteen distinct menu-owning shops per app", () => {
  for (const app of ["Zomato", "Swiggy", "Toing"]) {
    const shops = buildSampleShops(app, { lat: 12.9716, lng: 77.5946 });
    expect(shops).toHaveLength(15);
    expect(new Set(shops.map((shop) => shop.shopName)).size).toBe(15);
    expect(shops.every((shop) => shop.menu.length > 0 && shop.menu.every((item) =>
      item.itemId && item.itemName && item.category && Number.isFinite(item.price) &&
      typeof item.veg === "boolean"
    ))).toBe(true);
  }
});

test("reuses menu matches for a rounded cache location but regenerates exact coordinates", async () => {
  const adapter = createMockAdapter("Zomato");
  const options = {
    food: "chicken rice",
    location: { lat: 45.5019, lng: -73.5674 },
    radiusKm: 5,
    minPrice: 0,
    maxPrice: 100000,
    minRating: 0,
    shopName: "",
    veg: "both",
    matchMode: "strict"
  };
  const first = await adapter(options);
  const second = await adapter({
    ...options,
    location: { lat: 45.5021, lng: -73.5674 }
  });

  expect(first.map((item) => item.itemId)).toEqual(second.map((item) => item.itemId));
  expect(first[0].lat).not.toBe(second[0].lat);
});

test("preserves confirmed GPS accuracy in the shared comparison location", async () => {
  const response = await request(createTestApp({ logNoResults: vi.fn() }))
    .get("/api/compare")
    .query({ food: "chicken rice", ...locationQuery, source: "gps", accuracyMeters: "42" });

  expect(response.status).toBe(200);
  expect(response.body.location).toMatchObject({
    lat: 45.5019,
    lng: -73.5674,
    source: "gps",
    accuracyMeters: 42
  });
});

test("does not turn an unfamiliar query into a menu item", async () => {
  const response = await request(createTestApp({ logNoResults: vi.fn() }))
    .get("/api/compare")
    .query({ food: "Crispy tofu bowl", ...locationQuery });

  expect(response.status).toBe(200);
  expect(response.body.results).toEqual([]);
  expect(response.body.didYouMean.length).toBeGreaterThan(0);
});

test("filters sample shops by the requested radius and sorts by total", async () => {
  const response = await request(createTestApp({ logNoResults: vi.fn() }))
    .get("/api/compare")
    .query({ food: "biryani", ...locationQuery, radiusKm: "0.5" });

  expect(response.status).toBe(200);
  expect(response.body.results).toHaveLength(3);
  expect(response.body.results.every((item) => item.distanceKm <= 0.5)).toBe(true);
  expect(response.body.results.map((item) => item.finalTotal)).toEqual(
    [...response.body.results.map((item) => item.finalTotal)].sort((a, b) => a - b)
  );
});

test("returns an empty results array with 200 and logs zero-result searches", async () => {
  const logNoResults = vi.fn();
  const response = await request(createTestApp({ logNoResults }))
    .get("/api/compare")
    .query({
      food: "dish outside the budget",
      ...locationQuery,
      minPrice: "1000000",
      maxPrice: "2000000"
    });

  expect(response.status).toBe(200);
  expect(response.body.results).toEqual([]);
  expect(response.body.recommendation).toBeNull();
  expect(logNoResults).toHaveBeenCalledWith(expect.objectContaining({
    event: "food_search_no_results",
    food: "dish outside the budget"
  }));
});

test("serves up to eight fuzzy dish suggestions", async () => {
  const response = await request(createTestApp())
    .get("/api/suggest")
    .query({ q: "biriyani" });

  expect(response.status).toBe(200);
  expect(response.body.suggestions).toContain("Chicken Dum Biryani");
  expect(response.body.suggestions.length).toBeLessThanOrEqual(8);
});

test.each(["chicken rice", "paneer butter masala", "parotta"])(
  "searches actual menus for %s and changes the matching shop list",
  async (food) => {
    const response = await request(createTestApp({ logNoResults: vi.fn() }))
      .get("/api/compare")
      .query({ food, ...locationQuery });

    expect(response.status).toBe(200);
    expect(response.body.results.length).toBeGreaterThan(0);
    expect(response.body.results.every((item) =>
      buildSampleShops(item.app, { lat: 45.5019, lng: -73.5674 })
        .find((shop) => shop.shopId === item.shopId)
        ?.menu.some((menuItem) => menuItem.itemId === item.itemId && menuItem.itemName === item.itemName)
    )).toBe(true);
    if (food === "chicken rice") {
      expect(response.body.results.some((item) => /biryani/i.test(item.itemName))).toBe(false);
    }
  }
);

test("filters to the optional shop name and never fabricates its menu items", async () => {
  const response = await request(createTestApp({ logNoResults: vi.fn() }))
    .get("/api/compare")
    .query({ food: "chicken rice", shopName: "Curry Leaf", ...locationQuery });

  expect(response.status).toBe(200);
  expect(response.body.results.length).toBeGreaterThan(0);
  expect(new Set(response.body.results.map((item) => item.shopName))).toEqual(new Set(["Curry Leaf Kitchen"]));
  expect(response.body.results.every((item) =>
    item.itemName === "Chicken Fried Rice" || item.itemName === "Chicken Rice Bowl"
  )).toBe(true);
});

test("groups the same shop across apps only within 150 meters", async () => {
  const response = await request(createTestApp({ logNoResults: vi.fn() }))
    .get("/api/compare")
    .query({ food: "chicken rice", ...locationQuery });
  const sharedShop = response.body.groups.find((group) =>
    group.restaurantName === "Curry Leaf Kitchen" && group.options.length === 3
  );

  expect(sharedShop).toBeDefined();
  expect(new Set(sharedShop.options.map((item) => item.provider))).toEqual(new Set(["Zomato", "Swiggy", "Toing"]));
  expect(sharedShop.options.every((item) => item.itemName === sharedShop.dish)).toBe(true);
});

test("changes generated distances with the selected coordinates and respects radius", async () => {
  const app = createTestApp({ logNoResults: vi.fn() });
  const first = await request(app).get("/api/compare")
    .query({ food: "chicken rice", ...locationQuery, radiusKm: "1" });
  const second = await request(app).get("/api/compare")
    .query({
      food: "chicken rice",
      ...locationQuery,
      lat: "45.5119",
      lng: "-73.5674",
      radiusKm: "1"
    });

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.body.results.every((item) => item.distanceKm <= 1)).toBe(true);
  expect(second.body.results.every((item) => item.distanceKm <= 1)).toBe(true);
  expect(first.body.results[0].distanceKm).not.toBe(second.body.results[0].distanceKm);
});

test("reverse-geocodes the exact coordinates and prefers suburb over neighbourhood", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      address: {
        house_number: "5/3",
        road: "Main Road",
        suburb: "Pallavaram",
        neighbourhood: "Old Neighbourhood",
        city: "Chennai",
        state_district: "Chennai",
        state: "Tamil Nadu",
        country: "India",
        postcode: "600043"
      }
    })
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = createTestApp();

  const response = await request(app)
    .get("/api/reverse-geocode")
    .query({ lat: "11.123456", lng: "76.999987" });

  expect(response.status).toBe(200);
  expect(response.body.address).toBe("5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043");
  expect(response.body.addressFound).toBe(true);
  expect(response.body.location).toMatchObject({
    area: "Pallavaram",
    city: "Chennai",
    country: "India",
    state: "Tamil Nadu",
    district: "Chennai",
    address: "5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043",
    pincode: "600043",
    lat: 11.123456,
    lng: 76.999987
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  const reverseUrl = new URL(fetchMock.mock.calls[0][0].toString());
  expect(reverseUrl.origin).toBe("https://nominatim.openstreetmap.org");
  expect(reverseUrl.searchParams.get("lat")).toBe("11.123456");
  expect(reverseUrl.searchParams.get("lon")).toBe("76.999987");
  expect(reverseUrl.searchParams.get("zoom")).toBe("18");
  expect(reverseUrl.searchParams.get("addressdetails")).toBe("1");
  expect(reverseUrl.searchParams.get("accept-language")).toBe("en");
  expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toContain("PlatewiseSmartCompare");
});

test("does not reuse a reverse address for nearby but different coordinates", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { suburb: "First Area", city: "Sample City", state: "Tamil Nadu", country: "India" }
      })
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { suburb: "Second Area", city: "Sample City", state: "Tamil Nadu", country: "India" }
      })
    });
  vi.stubGlobal("fetch", fetchMock);
  const app = createTestApp();
  const first = await request(app).get("/api/reverse-geocode")
    .query({ lat: "12.98761", lng: "80.12341" });
  const second = await request(app).get("/api/reverse-geocode")
    .query({ lat: "12.98764", lng: "80.12344" });

  expect(first.body.location.area).toBe("First Area");
  expect(second.body.location).toMatchObject({
    area: "Second Area",
    lat: 12.98764,
    lng: 80.12344
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("reuses a cached reverse address only for the exact same coordinates", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      address: {
        suburb: "First Area",
        city: "Sample City",
        state: "Tamil Nadu",
        country: "India"
      }
    })
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = createTestApp();
  const first = await request(app).get("/api/reverse-geocode")
    .query({ lat: "11.223456", lng: "79.100001" });
  const second = await request(app).get("/api/reverse-geocode")
    .query({ lat: "11.223456", lng: "79.100001" });

  expect(first.body.location.area).toBe("First Area");
  expect(second.body.location.area).toBe("First Area");
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("does not fall back to another provider when Nominatim has no address", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address: {} }) });
  vi.stubGlobal("fetch", fetchMock);
  const response = await request(createTestApp())
    .get("/api/reverse-geocode")
    .query({ lat: "12.9257923", lng: "80.1179194" });

  expect(response.status).toBe(502);
  expect(response.body).toMatchObject({
    addressFound: false,
    coordinates: { lat: 12.9257923, lng: 80.1179194 }
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("returns the coordinate fallback message when Nominatim fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Nominatim offline")));
  const response = await request(createTestApp())
    .get("/api/reverse-geocode")
    .query({ lat: "12.5", lng: "77.5" });

  expect(response.status).toBe(502);
  expect(response.body).toMatchObject({
    addressFound: false,
    fallbackMessage: "Address not found. Drag the pin or type your area",
    coordinates: { lat: 12.5, lng: 77.5 }
  });
});

test("validates reverse-geocoding coordinates", async () => {
  const response = await request(createTestApp())
    .get("/api/reverse-geocode")
    .query({ lat: "91", lng: "0" });

  expect(response.status).toBe(400);
});

test("rejects reverse-geocoded points outside Tamil Nadu", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      address: {
        suburb: "Indiranagar",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India"
      }
    })
  }));
  const response = await request(createTestApp())
    .get("/api/reverse-geocode")
    .query({ lat: "12.9716", lng: "77.5946" });

  expect(response.status).toBe(422);
  expect(response.body.error).toMatch(/Tamil Nadu only/);
  expect(response.body.coordinates).toEqual({ lat: 12.9716, lng: 77.5946 });
});

test("searches Nominatim with the Tamil Nadu-only viewbox and parses lat/lon strings", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{
      lat: "12.9257923",
      lon: "80.1179194",
      address: {
        neighbourhood: "West Tambaram",
        town: "Tambaram",
        state_district: "Chengalpattu",
        state: "Tamil Nadu",
        country: "India",
        postcode: "600045"
      }
    }]
  });
  vi.stubGlobal("fetch", fetchMock);
  const response = await request(createTestApp())
    .get("/api/location-suggest")
    .query({ q: "Tambaram" });

  expect(response.status).toBe(200);
  expect(response.body.locations[0]).toMatchObject({
    area: "West Tambaram",
    city: "Tambaram",
    district: "Chengalpattu",
    state: "Tamil Nadu",
    pincode: "600045",
    lat: 12.9257923,
    lng: 80.1179194
  });
  const nominatimUrl = new URL(fetchMock.mock.calls[0][0].toString());
  expect(nominatimUrl.origin).toBe("https://nominatim.openstreetmap.org");
  expect(nominatimUrl.pathname).toBe("/search");
  expect(nominatimUrl.searchParams.get("q")).toBe("Tambaram");
  expect(nominatimUrl.searchParams.get("countrycodes")).toBe("in");
  expect(nominatimUrl.searchParams.get("viewbox")).toBe("76.2,13.6,80.4,8.0");
  expect(nominatimUrl.searchParams.get("bounded")).toBe("1");
  expect(nominatimUrl.searchParams.get("addressdetails")).toBe("1");
  expect(nominatimUrl.searchParams.get("limit")).toBe("5");
  expect(fetchMock.mock.calls[0][1].headers.Referer).toBe("http://localhost:5173/");
});

test("searches Tamil Nadu towns and preserves their matching pin and address", async () => {
  const places = [
    { query: "Pallavaram", area: "Pallavaram", city: "Chennai", district: "Chengalpattu", pincode: "600043", lat: 12.9678, lng: 80.1491 },
    { query: "T. Nagar", area: "T. Nagar", city: "Chennai", district: "Chennai", pincode: "600017", lat: 13.0418, lng: 80.2337 },
    { query: "Tambaram", area: "West Tambaram", city: "Tambaram", district: "Chengalpattu", pincode: "600045", lat: 12.9249, lng: 80.1 },
    { query: "Coimbatore", area: "Coimbatore", city: "Coimbatore", district: "Coimbatore", pincode: "641001", lat: 11.0168, lng: 76.9558 },
    { query: "Madurai", area: "Madurai", city: "Madurai", district: "Madurai", pincode: "625001", lat: 9.9252, lng: 78.1198 },
    { query: "Trichy", area: "Trichy", city: "Tiruchirappalli", district: "Tiruchirappalli", pincode: "620001", lat: 10.7905, lng: 78.7047 },
    { query: "Salem", area: "Salem", city: "Salem", district: "Salem", pincode: "636001", lat: 11.6643, lng: 78.146 }
  ];
  const fetchMock = vi.fn((url) => {
    const searchQuery = new URL(url.toString()).searchParams.get("q");
    const place = places.find(({ query }) => searchQuery.startsWith(query));
    return Promise.resolve({
      ok: true,
      json: async () => [{
        lat: String(place.lat),
        lon: String(place.lng),
        address: {
          neighbourhood: place.area,
          city: place.city,
          state_district: place.district,
          state: "Tamil Nadu",
          country: "India",
          postcode: place.pincode
        }
      }]
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = createTestApp();

  for (const place of places) {
    const response = await request(app).get("/api/location-suggest")
      .query({ q: `${place.query} TN test` });
    expect(response.status).toBe(200);
    expect(response.body.locations[0]).toMatchObject({
      area: place.area,
      city: place.city,
      district: place.district,
      pincode: place.pincode,
      lat: place.lat,
      lng: place.lng
    });
    expect(response.body.locations[0].address).toContain(place.pincode);
  }
}, 15000);

test("caches repeated location searches and excludes results outside Tamil Nadu", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      {
        lat: "12.9257923",
        lon: "80.1179194",
        address: {
          suburb: "West Tambaram",
          town: "Tambaram",
          state: "Tamil Nadu",
          country: "India",
          postcode: "600045"
        }
      },
      {
        lat: "9.9252",
        lon: "78.1198",
        address: {
          city: "Madurai",
          state: "Kerala",
          country: "India",
          postcode: "625001"
        }
      }
    ]
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = createTestApp();
  const first = await request(app).get("/api/location-suggest").query({ q: "Tambaram cache check" });
  const second = await request(app).get("/api/location-suggest").query({ q: "Tambaram cache check" });

  expect(first.body.locations).toHaveLength(1);
  expect(second.body.locations[0].pincode).toBe("600045");
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("spaces Nominatim requests at least one second apart", async () => {
  const requestStartedAt = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
    requestStartedAt.push(Date.now());
    return { ok: true, json: async () => [] };
  }));
  const app = createTestApp();
  await request(app).get("/api/location-suggest").query({ q: "rate limit first" });
  await request(app).get("/api/location-suggest").query({ q: "rate limit second" });

  expect(requestStartedAt).toHaveLength(2);
  expect(requestStartedAt[1] - requestStartedAt[0]).toBeGreaterThanOrEqual(950);
}, 5000);

test("ignores location queries shorter than three characters", async () => {
  const response = await request(createTestApp())
    .get("/api/location-suggest")
    .query({ q: "12" });

  expect(response.status).toBe(200);
  expect(response.body.locations).toEqual([]);
});

test("returns 400 for missing food or location, not for unfamiliar dishes", async () => {
  const app = createTestApp({ logNoResults: vi.fn() });
  const missingFood = await request(app).get("/api/compare?lat=12&lng=77");
  const missingLocation = await request(app).get("/api/compare?food=dosa");

  expect(missingFood.status).toBe(400);
  expect(missingLocation.status).toBe(400);
});

test("rejects manual address text without selected coordinates", async () => {
  const response = await request(createTestApp())
    .get("/api/compare")
    .query({ food: "biryani", address: "Bengaluru" });

  expect(response.status).toBe(400);
});

test("searches a manually entered address even when geocoding did not provide a city", async () => {
  const response = await request(createTestApp())
    .get("/api/compare")
    .query({
      food: "biryani",
      lat: "12.9678",
      lng: "80.1491",
      address: "Pallavaram, Chennai, Tamil Nadu, 600043",
      label: "Pallavaram, Chennai, Tamil Nadu, 600043",
      source: "manual"
    });

  expect(response.status).toBe(200);
  expect(new URL(response.body.results[0].searchUrl).searchParams.get("query"))
    .toContain("Pallavaram, Chennai, Tamil Nadu, 600043");
});
