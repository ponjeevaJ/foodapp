# Smart Compare Engine

Mock-backed comparison API for ordering the same dish across food delivery apps. It uses authorized-integration placeholders only; it does not scrape apps or bypass access controls.

Food search accepts arbitrary text, including Unicode. Searches are sanitized to 60 characters and matched against each sample shop's real menu items: exact item name, then all query words in the item name/category, then a strict fuzzy tier labeled “Similar to your search.” The app never copies the query into a shop listing.

## Structure

```text
src/
  adapters/       Provider adapters with separate sample shop catalogs
  data/           Per-app sample shop menus, coupon data, and dish synonyms
  domain/         Search, pricing, fuzzy matching, ranking, and comparison
  server.js       HTTP API, validation, timeout handling, cache, and rate limit
test/             Vitest, Supertest API, and React Testing Library suites
e2e/              Playwright browser tests
```

## Run

Requires Node.js 20 or newer.

```sh
npm install
npm test
```

The first E2E run requires Playwright's browser install: `npx playwright install chromium`. Run only unit/API/component coverage with `npm run test:unit`, or only browser tests with `npm run test:e2e`.

In separate terminals, start the API and React development server:

```sh
npm start
npm run dev
```

The API listens on `http://localhost:3000` (override with `PORT`); the UI is at `http://localhost:5173` and proxies `/api` requests to it. Create a production UI build with `npm run build`.

## Compare API

```text
GET /api/compare?lat=%3Cselected-lat%3E&lng=%3Cselected-lng%3E&address=%3Cconfirmed-address%3E&label=%3Cconfirmed-label%3E&area=%3Carea%3E&city=%3Ccity%3E&country=%3Ccountry%3E&source=manual&radiusKm=5&food=Chicken%20Dum%20Biryani&shopName=%3Coptional-shop-name%3E&veg=non-veg&minPrice=100&maxPrice=500&minRating=4&priority=Best%20overall
GET /api/suggest?q=biriyani
GET /api/location-suggest?q=%3Cplace-text%3E&city=%3Coptional-city-bias%3E
GET /api/reverse-geocode?lat=%3Cselected-lat%3E&lng=%3Cselected-lng%3E
```

`/api/compare` requires a confirmed location record (`lat`, `lng`, `label`, `area`, `city`, `country`, and `source`); an unverified address is rejected rather than searched at a fallback location. The UI accepts free-text places, requires the user to select a suggestion, and reverse-geocodes its coordinates to verify its city and country. The confirmed record is stored in one localStorage entry. Optional query parameters: `radiusKm` (default 5 km, up to 50), `targetPrice`, and `groupSize` (1-50). `veg` accepts `veg`, `non-veg`, `both`, or boolean-like `true`/`false`.

`/api/suggest` returns up to eight menu-backed fuzzy-matched dishes or popular dishes for an empty query. `/api/compare` returns grouped shops and per-provider options, mismatch warnings, per-provider availability, scores and price breakdowns, recommendation badges, savings, order links, and available price/delivery intelligence. The optional `shopName` query filters shops while still requiring a matching menu item. A no-match result is HTTP 200 with `results: []`, an explicit nearby-shop empty state, and separate dish suggestions. Each provider adapter caches menu matches by app, normalized food query, and coordinates rounded to three decimals; it regenerates coordinates and distances for each request. Requests are limited to 60 per IP per minute.

The location picker debounces free-text area, street, landmark, and pincode searches by 300 ms and requires selection from up to six India-only suggestions. Photon is queried first; Nominatim is retried when Photon fails or has no matches, then both providers are tried with a house-number-free query, an area-and-city query, and an area-only query. A previously selected city and its coordinates provide a soft bias; Nominatim uses an unbounded viewbox, `countrycodes=in`, a descriptive User-Agent/Referer, and a one-request-per-second limit. The confirmed location, including its full reverse-geocoded `address`, exact `lat`/`lng`, `city`, `pincode`, and provider metadata, is stored in one localStorage record and passed unchanged to shop search and provider search links. Map clicks, marker drags, and current-location readings reverse-geocode their exact coordinates into a pending location; the address field reflects that pending address and searching starts only after confirmation. Reverse geocoding includes street/area, city, state, and pincode where available, and does not reuse cached reverse results. Failed lookups display the exact coordinates and let the user edit the address or choose another map point. Without a saved location, the map opens without a selected pin at a neutral map center, so GPS denial does not block manual selection or create a default search location. Current location requires HTTPS or localhost and requests high accuracy with a 15-second timeout and `maximumAge: 0`; it centers the map and pin before reverse geocoding. To set the Nominatim Referer in production, optionally set `APP_PUBLIC_URL` to the public app URL. No geocoding API key is required. To test on a phone, expose the Vite app over HTTPS with a tunnel such as ngrok and configure the tunnel to forward to the Vite port; keep the API reachable through Vite's `/api` proxy. You can also configure Vite HTTPS for a trusted local certificate.

Coupon examples are stored in `src/data/coupons.sample.json` and are explicitly synthetic sample data, not live provider offers. `src/domain/couponPricing.mjs` calculates the best eligible single coupon per app and supports percentage, flat, and free-delivery discounts plus date, shop, first-order, and payment-method filters. The UI recalculates and sorts totals when coupon settings change. It always identifies sample coupons and shows: “Coupon prices are estimates. Offers can vary by account and payment method; confirm at checkout.” Replace the sample JSON with verified, licensed provider data before treating any coupon total as real.

Each provider has a distinct sample shop catalog with 15 shops and individual menus. The Zomato, Swiggy, and Toing adapters match only items present in each shop's menu, generate shop coordinates around the confirmed location, calculate distance using haversine, and exclude shops outside the selected radius. Shared sample shops use the same normalized name and coordinates across apps so like-for-like item prices can be grouped. Shop names, menus, ratings, prices, IDs, and location offsets are synthetic and marked “Sample data”; they are not live listings. No live food-app APIs are connected.

Every offer carries its app, shop and item identifiers, price, coordinates, provider URL fields, and a prebuilt shop-plus-selected-address search URL from `src/domain/orderLinks.mjs`. Sample offers have no real provider IDs or shop URLs, so their buttons say “Search … on …” and show a confirmation sheet before opening the provider search. The configured search URL formats still need verification for Zomato, Swiggy, and Toing; no deep-link or shop-page patterns are synthesized. A real adapter should pass through provider-verified IDs, `appShopUrl`, `appShopSlug`, `deepLink`, and `webUrl` when available.

### Real-data next steps

1. Replace mock adapters with official Zomato/Swiggy partner APIs, ONDC network APIs, or licensed data providers and verify their terms and field definitions.
2. Add licensed address geocoding and provider-specific item/portion identifiers; matching should prefer stable IDs when available.
3. Source current offer eligibility, taxes, surge fees, open state, ETA, and reliability from those providers; retain timestamps and expose stale-data indicators.
4. Persist price history and target alerts, then add a notification delivery channel and durable shared rate limiting/cache for production.
5. Add production observability, secrets management, and integration tests against provider sandboxes.
