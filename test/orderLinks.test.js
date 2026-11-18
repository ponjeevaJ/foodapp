import { expect, test, vi } from "vitest";
import {
  buildOrderLinks,
  getOrderLinkDetails,
  openOrderWithFallback,
  orderActionLabel
} from "../src/domain/orderLinks.mjs";

const location = { area: "Indiranagar", city: "Bengaluru" };

function sampleResult(app, shopName, shopId) {
  return {
    app,
    provider: app,
    shopName,
    shopId,
    itemName: "Chicken Fried Rice",
    itemId: `${shopId}-chicken-fried-rice`,
    price: 220,
    area: location.area,
    city: location.city,
    isSampleData: true,
    deepLink: null,
    appShopUrl: null,
    appShopSlug: null,
    webUrl: null
  };
}

test("builds distinct per-app search URLs from the clicked shop and delivery area", () => {
  const results = [
    sampleResult("Zomato", "Maple Wok", "zomato-maple-wok"),
    sampleResult("Swiggy", "Curry Leaf Kitchen", "swiggy-curry-leaf"),
    sampleResult("Toing", "Tandoor Corner", "toing-tandoor-corner")
  ];

  const links = results.map((result) => buildOrderLinks(result, location));
  expect(new Set(links.map((link) => link.searchUrl)).size).toBe(3);
  expect(links[0].searchUrl).toContain(encodeURIComponent("Maple Wok Indiranagar Bengaluru"));
  expect(links[1].searchUrl).toContain(encodeURIComponent("Curry Leaf Kitchen Indiranagar Bengaluru"));
  expect(links[2].searchUrl).toContain(encodeURIComponent("Tandoor Corner Indiranagar Bengaluru"));
  expect(links.every((link) => !link.deepLink && !link.webUrl)).toBe(true);
});

test("uses the selected full delivery address when building provider search links", () => {
  const deliveryLocation = {
    ...location,
    address: "5/3 Main Road, Indiranagar, Bengaluru, Karnataka, 560038",
    lat: 12.9716,
    lng: 77.5946
  };
  const links = buildOrderLinks(
    sampleResult("Swiggy", "Curry Leaf Kitchen", "swiggy-curry-leaf"),
    deliveryLocation
  );

  expect(links.searchUrl).toContain(encodeURIComponent(
    "Curry Leaf Kitchen 5/3 Main Road, Indiranagar, Bengaluru, Karnataka, 560038"
  ));
});

test("keeps each provider-supplied direct URL bound to that result's shop id", () => {
  const entries = [
    ["Zomato", "zomato.com", "zomato-shop-17"],
    ["Swiggy", "swiggy.com", "swiggy-shop-29"],
    ["Toing", "toing.com", "toing-shop-31"]
  ];
  const results = entries.map(([app, domain, shopId]) => ({
    ...sampleResult(app, `${app} Test Shop`, shopId),
    isSampleData: false,
    deepLink: `https://www.${domain}/provider-supplied/${shopId}`,
    appShopUrl: `https://www.${domain}/provider-supplied/${shopId}`
  }));
  const links = results.map((result) => buildOrderLinks(result, location));

  expect(links.map((link) => link.deepLink)).toEqual(
    results.map((result) => result.deepLink)
  );
  expect(links.every((link, index) =>
    link.deepLink.includes(results[index].shopId) &&
    link.webUrl.includes(results[index].shopId)
  )).toBe(true);
});

test("uses provided shop URLs but never manufactures a link from an unverified shop id", () => {
  const result = {
    ...sampleResult("Zomato", "Andhra House", "verified-shop-42"),
    isSampleData: false,
    deepLink: "https://www.zomato.com/bengaluru/verified-shop-42/menu",
    appShopUrl: "https://www.zomato.com/bengaluru/verified-shop-42"
  };

  expect(buildOrderLinks(result, location)).toEqual({
    deepLink: result.deepLink,
    webUrl: result.appShopUrl,
    searchUrl: "https://www.zomato.com/search?query=Andhra%20House%20Indiranagar%20Bengaluru"
  });
  expect(orderActionLabel(result)).toBe("Order now");

  const sample = {
    ...sampleResult("Zomato", "Sample Shop", "sample-zomato-shop"),
    deepLink: "https://www.zomato.com/not-a-real-shop",
    appShopUrl: "https://www.zomato.com/not-a-real-shop"
  };
  expect(buildOrderLinks(sample, location)).toEqual({
    deepLink: null,
    webUrl: null,
    searchUrl: "https://www.zomato.com/search?query=Sample%20Shop%20Indiranagar%20Bengaluru"
  });
  expect(orderActionLabel(sample)).toBe("Search Sample Shop on Zomato");
  expect(getOrderLinkDetails(sample, location).linkType).toBe("searchUrl");
});

test("falls back from a failed deep link to web URL and then search URL", () => {
  const result = {
    ...sampleResult("Swiggy", "Real Shop", "swiggy-shop-1"),
    isSampleData: false,
    deepLink: "https://www.swiggy.com/shop/deep-link",
    appShopUrl: "https://www.swiggy.com/restaurants/real-shop",
    searchUrl: "https://www.swiggy.com/search?query=Real%20Shop"
  };
  const attempts = [];
  const outcome = openOrderWithFallback(result, location, (url, linkType) => {
    attempts.push({ url, linkType });
    return linkType === "searchUrl";
  });

  expect(attempts.map(({ linkType }) => linkType)).toEqual(["deepLink", "webUrl", "searchUrl"]);
  expect(outcome).toMatchObject({ opened: true, linkType: "searchUrl" });
});

test("stops at the web URL when it opens and leaves the clicked result unchanged", () => {
  const result = Object.freeze({
    ...sampleResult("Toing", "Spice Garden", "toing-spice-garden"),
    isSampleData: false,
    appShopUrl: "https://toing.com/shops/spice-garden"
  });
  const original = { ...result };
  const openUrl = vi.fn(() => ({}));

  const outcome = openOrderWithFallback(result, location, openUrl);

  expect(outcome).toMatchObject({ opened: true, linkType: "webUrl" });
  expect(openUrl).toHaveBeenCalledTimes(1);
  expect(result).toEqual(original);
});

test("rejects links outside the configured app domain", () => {
  const result = {
    ...sampleResult("Toing", "Sample Shop", "toing-sample"),
    deepLink: "https://unsafe.example/shop",
    appShopUrl: "http://toing.com/shops/sample"
  };
  expect(buildOrderLinks(result, location)).toEqual({
    deepLink: null,
    webUrl: null,
    searchUrl: "https://toing.com/search?query=Sample%20Shop%20Indiranagar%20Bengaluru"
  });
});
