import { expect, test } from "@playwright/test";

test("searches biryani at a selected location and highlights the cheapest app", async ({ page }) => {
  await page.route("**/api/location-suggest?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      locations: [{
        label: "Indiranagar, Bengaluru, India",
        area: "Indiranagar",
        city: "Bengaluru",
        country: "India",
        pincode: "560038",
        lat: 12.9716,
        lng: 77.5946,
        source: "manual"
      }]
    })
  }));
  await page.route("**/api/reverse-geocode?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      address: "Indiranagar, Bengaluru, India",
      location: {
        label: "Indiranagar, Bengaluru, India",
        area: "Indiranagar",
        city: "Bengaluru",
        country: "India",
        pincode: "560038",
        lat: 12.9716,
        lng: 77.5946
      }
    })
  }));
  await page.goto("/");

  const locationInput = page.locator("#location-input");
  await locationInput.fill("Indiranagar, Bengaluru, India");
  await page.getByRole("option", { name: /Indiranagar, Bengaluru, 560038/ }).click();
  const mapDialog = page.getByRole("dialog", { name: "Pick on map" });
  await expect(mapDialog).toContainText("Indiranagar, Bengaluru, India");
  await mapDialog.getByRole("button", { name: "OK / Confirm Location" }).click();

  const foodInput = page.getByRole("combobox", { name: "Dish or cuisine" });
  await foodInput.fill("biryani");
  await foodInput.press("Enter");

  await expect(page.getByRole("heading", { name: "Here’s the good stuff." })).toBeVisible();
  await expect(page.getByText("Curry Leaf Kitchen").first()).toBeVisible();
  await expect(page.getByText("Searching near: Indiranagar, Bengaluru (12.97160, 77.59460)")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Search .* on Zomato$/ }).first()).toBeVisible();
  await expect(page.getByText("Cheapest", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(
    "Coupon prices are estimates. Offers can vary by account and payment method; confirm at checkout."
  )).toBeVisible();
  await expect(page.getByText(/SAMPLE-Z50/).first()).toBeVisible();
  await expect(page.locator(".winner-card h3")).toHaveText("Zomato");

  const applyCoupons = page.getByRole("checkbox", { name: "Apply coupons" });
  await applyCoupons.uncheck();
  await expect(page.locator(".winner-card h3")).toHaveText("Swiggy");
  await applyCoupons.check();
  await expect(page.locator(".winner-card h3")).toHaveText("Zomato");
});

test("picks a map location, confirms it, and compares coupon-adjusted chicken rice prices", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const savedLocation = {
    label: "Seed Area, Bengaluru, India",
    area: "Seed Area",
    city: "Bengaluru",
    country: "India",
    pincode: "560001",
    lat: 12.9716,
    lng: 77.5946,
    source: "manual",
    accuracyMeters: null
  };
  await page.addInitScript((location) => {
    localStorage.setItem("platewise.lastLocation", JSON.stringify(location));
  }, savedLocation);
  let clickedCoordinates;
  await page.route("**/api/reverse-geocode?*", async (route) => {
    const url = new URL(route.request().url());
    clickedCoordinates = {
      lat: Number(url.searchParams.get("lat")),
      lng: Number(url.searchParams.get("lng"))
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: {
          label: "Map Picked Area, Bengaluru, India",
          area: "Map Picked Area",
          city: "Bengaluru",
          country: "India",
          pincode: "560038",
          ...clickedCoordinates
        }
      })
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Pick on map" }).click();
  const map = page.locator(".location-map");
  await map.waitFor();
  const bounds = await map.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const mapDialog = page.getByRole("dialog", { name: "Pick on map" });
  await expect(mapDialog).toContainText("Map Picked Area, Bengaluru, India");
  const confirmButton = mapDialog.getByRole("button", { name: "OK / Confirm Location" });
  await expect(confirmButton).toBeVisible();
  const confirmBounds = await confirmButton.boundingBox();
  expect(confirmBounds.y + confirmBounds.height).toBeLessThanOrEqual(844);
  await confirmButton.click();

  const confirmedLocation = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("platewise.lastLocation"))
  );
  expect(confirmedLocation.lat).toBe(clickedCoordinates.lat);
  expect(confirmedLocation.lng).toBe(clickedCoordinates.lng);

  const foodInput = page.getByRole("combobox", { name: "Dish or cuisine" });
  await foodInput.fill("chicken rice");
  await foodInput.press("Enter");
  await expect(page.getByRole("heading", { name: "Here’s the good stuff." })).toBeVisible();
  await expect(page.getByText("Coupon prices are estimates.", { exact: false })).toBeVisible();
  await expect(page.getByText(/SAMPLE-Z50/).first()).toBeVisible();
  const dishRows = await page.locator(".app-dish").allTextContents();
  expect(dishRows.length).toBeGreaterThan(0);
  expect(dishRows.every((name) => /chicken/i.test(name) && /rice/i.test(name))).toBe(true);
  expect(dishRows.some((name) => /biryani/i.test(name))).toBe(false);
  await expect(page.locator(".winner-card h3")).toHaveText("Zomato");
});

test("uses current location, shows its reverse-geocoded name, and opens the correct app", async ({ page }) => {
  const coordinates = { lat: 12.9716, lng: 77.5946 };
  await page.context().route("https://www.zomato.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<html><title>Zomato search</title></html>"
  }));
  await page.context().route("https://www.swiggy.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<html><title>Swiggy search</title></html>"
  }));
  await page.context().route("https://toing.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<html><title>Toing search</title></html>"
  }));
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({
    latitude: coordinates.lat,
    longitude: coordinates.lng,
    accuracy: 42
  });
  await page.route("**/api/reverse-geocode?*", async (route) => {
    const url = new URL(route.request().url());
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        addressFound: true,
        address: "Indiranagar, Bengaluru 560038",
        location: {
          label: "Indiranagar, Bengaluru 560038",
          area: "Indiranagar",
          city: "Bengaluru",
          country: "India",
          pincode: "560038",
          lat,
          lng
        }
      })
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Use current location" }).click();
  const mapDialog = page.getByRole("dialog", { name: "Pick on map" });
  await expect(mapDialog).toContainText("Indiranagar, Bengaluru 560038");
  await expect(mapDialog).toContainText("(12.97160, 77.59460)");
  await mapDialog.getByRole("button", { name: "OK / Confirm Location" }).click();

  const locationInput = page.locator("#location-input");
  await expect(locationInput).toHaveValue("Indiranagar, Bengaluru 560038");
  const foodInput = page.getByRole("combobox", { name: "Dish or cuisine" });
  await foodInput.fill("chicken rice");
  await foodInput.press("Enter");
  await expect(page.getByRole("heading", { name: "Here’s the good stuff." })).toBeVisible();
  const dishRows = await page.locator(".app-dish").allTextContents();
  expect(dishRows.length).toBeGreaterThan(0);
  expect(dishRows.every((name) => /chicken/i.test(name) && /rice/i.test(name))).toBe(true);
  expect(dishRows.some((name) => /biryani/i.test(name))).toBe(false);

  const secondShop = page.locator(".shop-comparison").nth(1);
  const shopName = (await secondShop.locator(".shop-heading h3").innerText()).trim();
  const appCard = secondShop.locator(".app-card").first();
  const appName = (await appCard.locator(".app-title strong").innerText()).trim();
  const itemName = (await appCard.locator(".app-dish").innerText()).split("\n")[0].trim();
  const searchButton = appCard.getByRole("button", { name: `Search ${shopName} on ${appName}` });
  const popupPromise = page.context().waitForEvent("page");
  await searchButton.click();
  const confirmation = page.getByRole("dialog", { name: "Confirm your choice" });
  await expect(confirmation).toContainText(`You chose: ${itemName} from ${shopName} on ${appName}`);
  await expect(confirmation).toContainText("Delivery to: Indiranagar, Bengaluru");
  await expect(confirmation).toContainText(`If ${appName} shows different details, search for ${shopName} and add ${itemName}.`);
  await confirmation.getByRole("button", { name: `Open ${appName}` }).click();
  const popup = await popupPromise;
  const openedUrl = new URL(popup.url());
  expect(openedUrl.searchParams.get("query")).toBe(`${shopName} Indiranagar, Bengaluru 560038`);
  expect(openedUrl.hostname).toMatch(/zomato\.com|swiggy\.com|toing\.com/);
});
