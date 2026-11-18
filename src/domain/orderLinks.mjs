function isAppUrl(value, config) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const belongsToApp = host === config.domain || host.endsWith(`.${config.domain}`);
    return url.protocol === "https:" && belongsToApp && url.pathname !== "/"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function createProviderBuilder(config) {
  return (result, deliveryLocation) => {
    const shopName = result.shopName || result.restaurantName || "";
    const area = result.area || deliveryLocation?.area || "";
    const city = result.city || deliveryLocation?.city || "";
    const locationAddress = deliveryLocation?.address || [area, city].filter(Boolean).join(" ");
    const query = [shopName, locationAddress].filter(Boolean).join(" ");
    const searchUrl = isAppUrl(result.searchUrl, config) ||
      `${config.searchUrlBase}${encodeURIComponent(query)}`;
    const hasVerifiedShopData = !result.isSampleData && !result.isMock;

    return {
      deepLink: hasVerifiedShopData ? isAppUrl(result.deepLink, config) : null,
      webUrl: hasVerifiedShopData
        ? isAppUrl(result.appShopUrl, config) || isAppUrl(result.webUrl, config)
        : null,
      searchUrl
    };
  };
}

function createProviderConfig(domain, searchUrlBase) {
  const config = { domain, searchUrlBase };
  return Object.freeze({ ...config, buildLinks: createProviderBuilder(config) });
}

export const ORDER_LINK_CONFIG = Object.freeze({
  // TODO: Verify Zomato's search URL format; no deep-link or shop-page format is confirmed.
  Zomato: createProviderConfig("zomato.com", "https://www.zomato.com/search?query="),
  // TODO: Verify Swiggy's search URL format; no deep-link or shop-page format is confirmed.
  Swiggy: createProviderConfig("swiggy.com", "https://www.swiggy.com/search?query="),
  // TODO: Verify Toing's search URL format; no deep-link or shop-page format is confirmed.
  Toing: createProviderConfig("toing.com", "https://toing.com/search?query=")
});

function getApp(result) {
  return result.app || result.provider;
}

export function buildOrderLinks(result, deliveryLocation) {
  const app = getApp(result);
  const config = ORDER_LINK_CONFIG[app];
  if (!config) throw new Error(`No order-link configuration exists for ${app || "this app"}.`);
  return config.buildLinks(result, deliveryLocation);
}

export function getOrderLinkDetails(result, deliveryLocation) {
  const links = buildOrderLinks(result, deliveryLocation);
  if (links.deepLink) {
    return {
      ...links,
      app: getApp(result),
      url: links.deepLink,
      linkType: "deepLink",
      configPattern: "result.deepLink"
    };
  }
  if (links.webUrl) {
    return {
      ...links,
      app: getApp(result),
      url: links.webUrl,
      linkType: "webUrl",
      configPattern: "result.appShopUrl"
    };
  }
  const config = ORDER_LINK_CONFIG[getApp(result)];
  return {
    ...links,
    app: getApp(result),
    url: links.searchUrl,
    linkType: "searchUrl",
    configPattern: `${config.searchUrlBase}{shopName area city}`
  };
}

export function getOrderUrl(result, deliveryLocation) {
  return getOrderLinkDetails(result, deliveryLocation).url;
}

export function orderActionLabel(result) {
  const links = buildOrderLinks(result);
  const app = getApp(result);
  const shopName = result.shopName || result.restaurantName || "shop";
  return !result.isSampleData && !result.isMock && (links.deepLink || links.webUrl)
    ? "Order now"
    : `Search ${shopName} on ${app}`;
}

export function openOrderWithFallback(result, deliveryLocation, openUrl) {
  const links = buildOrderLinks(result, deliveryLocation);
  const candidates = [
    ["deepLink", links.deepLink],
    ["webUrl", links.webUrl],
    ["searchUrl", links.searchUrl]
  ].filter(([, url]) => Boolean(url));
  const failures = [];

  for (const [linkType, url] of candidates) {
    try {
      const opened = openUrl(url, linkType);
      if (opened !== false && opened != null) return { opened: true, url, linkType, failures };
      failures.push(`${linkType} was blocked.`);
    } catch (error) {
      failures.push(`${linkType} failed: ${error.message || "unknown error"}`);
    }
  }

  return { opened: false, url: null, linkType: null, failures };
}
