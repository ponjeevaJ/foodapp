import React from "react";
import { expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App.jsx";

vi.mock("../src/LocationMapPicker.jsx", () => ({
  default: ({ center, selectedPoint, onPick }) => (
    <div
      data-testid="location-map-picker"
      data-center={JSON.stringify([center.lat, center.lng])}
      data-point={selectedPoint ? JSON.stringify([selectedPoint.lat, selectedPoint.lng]) : ""}
    >
      <button type="button" onClick={() => onPick({ lat: 12.34567, lng: 77.12345 })}>Test map click</button>
      <button type="button" onClick={() => onPick({ lat: 12.34678, lng: 77.12456 })}>Test marker drag</button>
    </div>
  )
}));

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function manualLocationResponse(label = "Indiranagar, Bengaluru, India", lat = 12.9716, lng = 77.5946) {
  const [area, city, country] = label.split(",").map((part) => part.trim());
  return jsonResponse({
    locations: [{
      label,
      area,
      city,
      country,
      pincode: "",
      lat,
      lng,
      source: "manual"
    }]
  });
}

function reverseGeocodeResponse(url, address = "Indiranagar, Bengaluru, India") {
  const [, city, country] = address.split(",").map((part) => part.trim());
  return jsonResponse({
    address,
    location: {
      label: address,
      area: address.split(",")[0].trim(),
      city,
      country,
      pincode: "",
      lat: Number(new URL(`http://localhost${url}`).searchParams.get("lat")),
      lng: Number(new URL(`http://localhost${url}`).searchParams.get("lng"))
    }
  });
}

function selectedMapResponse(url, area = "Map Area") {
  const params = new URL(`http://localhost${url}`).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  return jsonResponse({
    location: {
      label: `${area}, Bengaluru, India`,
      area,
      city: "Bengaluru",
      country: "India",
      pincode: "560038",
      lat,
      lng
    }
  });
}

async function selectManualLocation(user, name = "Indiranagar, Bengaluru, India") {
  const input = screen.getByLabelText(/Your location/);
  fireEvent.change(input, { target: { value: name } });
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

test("does not search until a location is selected", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    results: [], comparison: null, groups: [], intelligence: {}
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Find my best pick" }));

  expect(await screen.findByText("Please choose your location.")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/compare"))).toBe(false);
  expect(localStorage.getItem("platewise.lastLocation")).toBeNull();
});

test("lets users submit free text and persists it in recent searches", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) return Promise.resolve(manualLocationResponse());
    if (String(url).startsWith("/api/reverse-geocode")) return Promise.resolve(reverseGeocodeResponse(String(url)));
    if (String(url).startsWith("/api/suggest")) return Promise.resolve(jsonResponse({ suggestions: [] }));
    return Promise.resolve(jsonResponse({
      results: [], comparison: null, groups: [], intelligence: {}, location: { areaName: "Bengaluru" }
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  await selectManualLocation(user);

  const foodInput = screen.getByRole("combobox", { name: "Dish or cuisine" });
  fireEvent.change(foodInput, { target: { value: "Mystery noodle" } });
  await user.click(await screen.findByRole("option", { name: /Search for “Mystery noodle”/ }));

  expect(await screen.findByRole("heading", {
    name: "No shop near Indiranagar has 'Mystery noodle'"
  })).toBeInTheDocument();
  expect(screen.getByText("Searching near: Indiranagar, Bengaluru (12.97160, 77.59460)")).toBeInTheDocument();
  expect(localStorage.getItem("platewise.recentSearches")).toContain("Mystery noodle");
  expect(fetchMock.mock.calls.some(([url]) =>
    String(url).includes("food=Mystery+noodle") && String(url).includes("area=Indiranagar") &&
    String(url).includes("city=Bengaluru") && String(url).includes("source=manual")
  )).toBe(true);

  await user.click(foodInput);
  expect(await screen.findByText("Recent searches")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(localStorage.getItem("platewise.recentSearches")).toBe("[]"));
});

test("shows inline guidance for a one-character food query", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ suggestions: [] })));
  render(<App />);

  const foodInput = screen.getByRole("combobox", { name: "Dish or cuisine" });
  await user.clear(foodInput);
  await user.type(foodInput, "x");
  expect(screen.getByRole("status")).toHaveTextContent("at least 2 characters");
});

test("aborts an in-flight comparison when the user types a newer dish", async () => {
  const user = userEvent.setup();
  let compareSignal;
  let resolveCompare;
  const fetchMock = vi.fn((url, options = {}) => {
    if (String(url).startsWith("/api/location-suggest")) return Promise.resolve(manualLocationResponse());
    if (String(url).startsWith("/api/reverse-geocode")) return Promise.resolve(reverseGeocodeResponse(String(url)));
    if (String(url).startsWith("/api/suggest")) return Promise.resolve(jsonResponse({ suggestions: [] }));
    compareSignal = options.signal;
    return new Promise((resolve) => {
      resolveCompare = resolve;
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  await selectManualLocation(user);

  const foodInput = screen.getByRole("combobox", { name: "Dish or cuisine" });
  fireEvent.change(foodInput, { target: { value: "Old custom dish" } });
  await user.click(await screen.findByRole("option", { name: /Search for “Old custom dish”/ }));
  await waitFor(() => expect(compareSignal).toBeDefined());

  fireEvent.change(foodInput, { target: { value: "New custom dish" } });
  expect(compareSignal.aborted).toBe(true);

  resolveCompare(jsonResponse({ results: [], comparison: null, groups: [], intelligence: {} }));
  expect(screen.queryByRole("heading", { name: /No shop near/ })).not.toBeInTheDocument();
});

test("requests a secure current location, shows its address, and searches with numeric coordinates", async () => {
  const user = userEvent.setup();
  const descriptors = {
    secure: Object.getOwnPropertyDescriptor(window, "isSecureContext"),
    permissions: Object.getOwnPropertyDescriptor(navigator, "permissions"),
    geolocation: Object.getOwnPropertyDescriptor(navigator, "geolocation")
  };
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: "prompt" }) }
  });
  const getCurrentPosition = vi.fn((success, _failure, options) => {
    expect(options).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    success({
      coords: { latitude: 12.34567, longitude: 77.12345, accuracy: 42 },
      timestamp: 123
    });
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition }
  });
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(jsonResponse({
        address: "5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043",
        location: {
          label: "5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043",
          address: "5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043",
          state: "Tamil Nadu",
          area: "Pallavaram",
          city: "Chennai",
          country: "India",
          pincode: "600043",
          lat: 12.34567,
          lng: 77.12345
        }
      }));
    }
    if (String(url).startsWith("/api/suggest")) {
      return Promise.resolve(jsonResponse({ suggestions: [] }));
    }
    return Promise.resolve(jsonResponse({ results: [], comparison: null, groups: [], intelligence: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Use current location" }));
    expect(await screen.findAllByText("Selected: Pallavaram, Chennai 600043")).toHaveLength(2);
    expect(screen.getByLabelText(/Your location/)).toHaveValue(
      "5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043"
    );
    expect(screen.getByText("(12.34567, 77.12345)")).toBeInTheDocument();
    expect(screen.getByTestId("location-map-picker")).toHaveAttribute(
      "data-center",
      JSON.stringify([12.34567, 77.12345])
    );
    expect(screen.getByTestId("location-map-picker")).toHaveAttribute(
      "data-point",
      JSON.stringify([12.34567, 77.12345])
    );
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(localStorage.getItem("platewise.lastLocation")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm location" }));
    expect(JSON.parse(localStorage.getItem("platewise.lastLocation"))).toEqual({
      label: "5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043",
      address: "5/3 Main Road, Pallavaram, Chennai, Tamil Nadu, 600043",
      state: "Tamil Nadu",
      area: "Pallavaram",
      city: "Chennai",
      country: "India",
      pincode: "600043",
      lat: 12.34567,
      lng: 77.12345,
      source: "gps",
      accuracyMeters: 42
    });

    await user.click(screen.getByRole("button", { name: "Find my best pick" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes("lat=12.34567") && String(url).includes("lng=77.12345") &&
      String(url).includes("area=Pallavaram") && String(url).includes("city=Chennai") &&
      String(url).includes("address=5%2F3+Main+Road%2C+Pallavaram%2C+Chennai%2C+Tamil+Nadu%2C+600043") &&
      String(url).includes("source=gps")
    )).toBe(true));
  } finally {
    for (const [key, property] of [["secure", "isSecureContext"], ["permissions", "permissions"], ["geolocation", "geolocation"]]) {
      if (descriptors[key]) Object.defineProperty(key === "secure" ? window : navigator, property, descriptors[key]);
      else delete (key === "secure" ? window : navigator)[property];
    }
  }
});

test("opens the draggable map for GPS accuracy worse than 500 m and confirms only after review", async () => {
  const user = userEvent.setup();
  const oldGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  const oldSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  const getCurrentPosition = vi.fn((success, _failure, options) => {
    expect(options).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    success({
      coords: { latitude: 12.34567, longitude: 77.12345, accuracy: 780 },
      timestamp: 456
    });
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition }
  });
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(jsonResponse({
        location: {
          label: "Pallavaram, Chennai, India",
          area: "Pallavaram",
          city: "Chennai",
          country: "India",
          pincode: "600043",
          lat: 12.34567,
          lng: 77.12345
        }
      }));
    }
    return Promise.resolve(jsonResponse({ results: [], comparison: null, groups: [], intelligence: {} }));
  }));
  try {
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Use current location" }));
    expect(await screen.findByText(/Location accuracy is low \(about 780 m\)/)).toBeInTheDocument();
    expect(screen.getByTestId("location-map-picker")).toHaveAttribute(
      "data-center",
      JSON.stringify([12.34567, 77.12345])
    );
    expect(localStorage.getItem("platewise.lastLocation")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm location" }));
    expect(JSON.parse(localStorage.getItem("platewise.lastLocation"))).toMatchObject({
      lat: 12.34567,
      lng: 77.12345,
      source: "gps",
      accuracyMeters: 780
    });
  } finally {
    if (oldGeolocation) Object.defineProperty(navigator, "geolocation", oldGeolocation);
    else delete navigator.geolocation;
    if (oldSecureContext) Object.defineProperty(window, "isSecureContext", oldSecureContext);
    else delete window.isSecureContext;
  }
});

test("map clicks preserve lat/lng, reverse geocode, and wait for confirmation before search", async () => {
  const user = userEvent.setup();
  const original = {
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
  localStorage.setItem("platewise.lastLocation", JSON.stringify(original));
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(selectedMapResponse(String(url), "Map Click Area"));
    }
    return Promise.resolve(jsonResponse({ results: [], comparison: null, groups: [], intelligence: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Find my best pick" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
    String(url).startsWith("/api/compare") && String(url).includes("lat=12.9716")
  )).toBe(true));
  const initialSearchCount = fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/compare")
  ).length;

  await user.click(screen.getByRole("button", { name: "Pick on map" }));
  expect(screen.getByTestId("location-map-picker")).toHaveAttribute(
    "data-center",
    JSON.stringify([original.lat, original.lng])
  );
  await user.click(screen.getByRole("button", { name: "Test map click" }));
  expect(await screen.findAllByText("Selected: Map Click Area, Bengaluru 560038")).toHaveLength(2);
  expect(screen.getByTestId("location-map-picker")).toHaveAttribute(
    "data-center",
    JSON.stringify([12.34567, 77.12345])
  );
  expect(screen.getByLabelText(/Your location/)).toHaveValue("Map Click Area, Bengaluru, India");
  expect(screen.getByText("(12.34567, 77.12345)")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) =>
    String(url).startsWith("/api/reverse-geocode") &&
    String(url).includes("lat=12.34567") &&
    String(url).includes("lng=77.12345")
  )).toBe(true);
  expect(JSON.parse(localStorage.getItem("platewise.lastLocation"))).toEqual(original);
  expect(fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/compare")
  )).toHaveLength(initialSearchCount);

  await user.click(screen.getByRole("button", { name: "Confirm location" }));
  expect(JSON.parse(localStorage.getItem("platewise.lastLocation"))).toMatchObject({
    area: "Map Click Area",
    lat: 12.34567,
    lng: 77.12345,
    source: "manual",
    accuracyMeters: null
  });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
    String(url).startsWith("/api/compare") &&
    String(url).includes("lat=12.34567") &&
    String(url).includes("lng=77.12345")
  )).toBe(true));
});

test("marker drag updates the confirmed shared location and the next search", async () => {
  const user = userEvent.setup();
  localStorage.setItem("platewise.lastLocation", JSON.stringify({
    label: "Seed Area, Bengaluru, India",
    area: "Seed Area",
    city: "Bengaluru",
    country: "India",
    pincode: "560001",
    lat: 12.9716,
    lng: 77.5946,
    source: "manual",
    accuracyMeters: null
  }));
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(selectedMapResponse(String(url), "Dragged Area"));
    }
    return Promise.resolve(jsonResponse({ results: [], comparison: null, groups: [], intelligence: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Pick on map" }));
  await user.click(screen.getByRole("button", { name: "Test marker drag" }));
  expect(await screen.findAllByText("Selected: Dragged Area, Bengaluru 560038")).toHaveLength(2);
  expect(screen.getByText("(12.34678, 77.12456)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm location" }));
  expect(JSON.parse(localStorage.getItem("platewise.lastLocation"))).toMatchObject({
    area: "Dragged Area",
    lat: 12.34678,
    lng: 77.12456
  });
  await user.click(screen.getByRole("button", { name: "Find my best pick" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
    String(url).startsWith("/api/compare") &&
    String(url).includes("lat=12.34678") &&
    String(url).includes("lng=77.12456")
  )).toBe(true));
});

test("ignores a stale reverse-geocode response after the marker moves again", async () => {
  const user = userEvent.setup();
  localStorage.setItem("platewise.lastLocation", JSON.stringify({
    label: "Seed Area, Bengaluru, India",
    area: "Seed Area",
    city: "Bengaluru",
    country: "India",
    pincode: "560001",
    lat: 12.9716,
    lng: 77.5946,
    source: "manual",
    accuracyMeters: null
  }));
  const pending = [];
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    if (String(url).startsWith("/api/reverse-geocode")) {
      return new Promise((resolve) => pending.push({ url: String(url), resolve, signal: options.signal }));
    }
    return Promise.resolve(jsonResponse({ results: [], comparison: null, groups: [], intelligence: {} }));
  }));
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Pick on map" }));
  await user.click(screen.getByRole("button", { name: "Test map click" }));
  await waitFor(() => expect(pending).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: "Test marker drag" }));
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0].signal.aborted).toBe(true);

  pending[1].resolve(selectedMapResponse(pending[1].url, "Newest Area"));
  expect(await screen.findAllByText("Selected: Newest Area, Bengaluru 560038")).toHaveLength(2);
  pending[0].resolve(selectedMapResponse(pending[0].url, "Stale Area"));
  await waitFor(() => {
    expect(screen.getAllByText("Selected: Newest Area, Bengaluru 560038")).toHaveLength(2);
    expect(screen.queryByText(/Stale Area/)).not.toBeInTheDocument();
  });
});

test("shows coordinates and a draggable map fallback when reverse geocoding fails", async () => {
  const user = userEvent.setup();
  const oldGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  const oldSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition(success) {
        success({ coords: { latitude: 12.34567, longitude: 77.12345, accuracy: 42 }, timestamp: 123 });
      }
    }
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({
      addressFound: false,
      fallbackMessage: "Address not found. Drag the pin or type your area",
      coordinates: { lat: 12.34567, lng: 77.12345 }
    })
  }));
  try {
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Use current location" }));
    expect(await screen.findByText(/Address not found\. Drag the pin or type your area/)).toBeInTheDocument();
    expect(screen.getByText(/12\.34567, 77\.12345/)).toBeInTheDocument();
    expect(screen.getByTestId("location-map-picker")).toHaveAttribute(
      "data-point",
      JSON.stringify([12.34567, 77.12345])
    );
    expect(screen.queryByRole("button", { name: "Confirm location" })).not.toBeInTheDocument();
  } finally {
    if (oldGeolocation) Object.defineProperty(navigator, "geolocation", oldGeolocation);
    else delete navigator.geolocation;
    if (oldSecureContext) Object.defineProperty(window, "isSecureContext", oldSecureContext);
    else delete window.isSecureContext;
  }
});

test("explains how to restore a denied location permission", async () => {
  const user = userEvent.setup();
  const oldPermission = Object.getOwnPropertyDescriptor(navigator, "permissions");
  const oldGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  const oldSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: "denied" }) }
  });
  const getCurrentPosition = vi.fn((_success, failure) => failure({ code: 1 }));
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition }
  });
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(selectedMapResponse(String(url), "Manual Map Area"));
    }
    return Promise.resolve(jsonResponse({ results: [], comparison: null, groups: [], intelligence: {} }));
  }));
  try {
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Use current location" }));
    expect(await screen.findByText(/Location permission was denied/)).toBeInTheDocument();
    expect(screen.getByText(/Open this site’s permissions/)).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Pick on map" }));
    expect(screen.getByTestId("location-map-picker")).toHaveAttribute(
      "data-center",
      JSON.stringify([0, 0])
    );
    expect(screen.getByTestId("location-map-picker")).toHaveAttribute("data-point", "");
    await user.click(screen.getByRole("button", { name: "Test map click" }));
    expect(await screen.findByLabelText(/Your location/)).toHaveValue("Manual Map Area, Bengaluru, India");
    expect(screen.getByRole("button", { name: "Confirm location" })).toBeInTheDocument();
  } finally {
    for (const [target, property, descriptor] of [
      [navigator, "permissions", oldPermission],
      [navigator, "geolocation", oldGeolocation],
      [window, "isSecureContext", oldSecureContext]
    ]) {
      if (descriptor) Object.defineProperty(target, property, descriptor);
      else delete target[property];
    }
  }
});

test("shows manual fallback when browser geolocation is unsupported", async () => {
  const user = userEvent.setup();
  const oldGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  const oldSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
  try {
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Use current location" }));
    expect(await screen.findByText(/does not support location/)).toBeInTheDocument();
    expect(screen.getByText(/Manual fallback/)).toBeInTheDocument();
  } finally {
    if (oldGeolocation) Object.defineProperty(navigator, "geolocation", oldGeolocation);
    else delete navigator.geolocation;
    if (oldSecureContext) Object.defineProperty(window, "isSecureContext", oldSecureContext);
    else delete window.isSecureContext;
  }
});

test("shows a clear manual fallback when current location times out", async () => {
  const user = userEvent.setup();
  const oldPermission = Object.getOwnPropertyDescriptor(navigator, "permissions");
  const oldGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  const oldSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: "prompt" }) }
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (_success, failure) => failure({ code: 3 }) }
  });
  try {
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Use current location" }));
    expect(await screen.findByText(/timed out/)).toBeInTheDocument();
    expect(screen.getByText(/Manual fallback/)).toBeInTheDocument();
  } finally {
    for (const [target, property, descriptor] of [
      [navigator, "permissions", oldPermission],
      [navigator, "geolocation", oldGeolocation],
      [window, "isSecureContext", oldSecureContext]
    ]) {
      if (descriptor) Object.defineProperty(target, property, descriptor);
      else delete target[property];
    }
  }
});

test("does not confirm a manual place when reverse geocoding resolves to another city", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) {
      return Promise.resolve(manualLocationResponse());
    }
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(reverseGeocodeResponse(String(url), "Somewhere, Another City, India"));
    }
    return Promise.resolve(jsonResponse({ results: [], groups: [], comparison: null, intelligence: {} }));
  }));
  render(<App />);

  const input = screen.getByLabelText(/Your location/);
  fireEvent.change(input, { target: { value: "Indiranagar, Bengaluru, India" } });
  await user.click(await screen.findByRole("option", { name: /Indiranagar, Bengaluru, India/ }));

  expect(await screen.findByText(/does not resolve inside the selected city and country/)).toBeInTheDocument();
  expect(localStorage.getItem("platewise.lastLocation")).toBeNull();
  expect(screen.queryByText(/Searching near:/)).not.toBeInTheDocument();
});

test("accepts a pincode query and displays area, city, and pincode before selection", async () => {
  const user = userEvent.setup();
  const suggestion = {
    label: "Indiranagar, Bengaluru, India",
    area: "Indiranagar",
    city: "Bengaluru",
    country: "India",
    pincode: "560038",
    lat: 12.9716,
    lng: 77.5946,
    source: "manual"
  };
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) {
      return Promise.resolve(jsonResponse({ locations: [suggestion], fallback: false }));
    }
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(reverseGeocodeResponse(String(url)));
    }
    return Promise.resolve(jsonResponse({ results: [], groups: [], comparison: null, intelligence: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  const input = screen.getByLabelText(/Your location/);
  fireEvent.change(input, { target: { value: "560038" } });
  const option = await screen.findByRole("option", { name: /Indiranagar, Bengaluru, 560038/ });
  const locationUrl = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
  expect(locationUrl.searchParams.get("q")).toBe("560038");
  await user.click(option);

  expect(JSON.parse(localStorage.getItem("platewise.lastLocation"))).toMatchObject({
    area: "Indiranagar",
    city: "Bengaluru",
    pincode: "560038",
    lat: 12.9716,
    lng: 77.5946
  });
});

test("selecting a Tambaram suggestion saves its exact coordinates", async () => {
  const user = userEvent.setup();
  const suggestion = {
    label: "West Tambaram, Tambaram, 600045, India",
    area: "West Tambaram",
    city: "Tambaram",
    country: "India",
    pincode: "600045",
    lat: 12.9257923,
    lng: 80.1179194,
    source: "manual"
  };
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) {
      return Promise.resolve(jsonResponse({ locations: [suggestion], fallback: false }));
    }
    if (String(url).startsWith("/api/reverse-geocode")) {
      return Promise.resolve(jsonResponse({
        location: {
          ...suggestion,
          label: suggestion.label,
          lat: Number(new URL(String(url), "http://localhost").searchParams.get("lat")),
          lng: Number(new URL(String(url), "http://localhost").searchParams.get("lng"))
        }
      }));
    }
    return Promise.resolve(jsonResponse({ results: [], groups: [], comparison: null, intelligence: {} }));
  }));
  render(<App />);

  fireEvent.change(screen.getByLabelText(/Your location/), { target: { value: "Tambaram" } });
  await user.click(await screen.findByRole("option", { name: /West Tambaram, Tambaram, 600045/ }));

  expect(JSON.parse(localStorage.getItem("platewise.lastLocation"))).toMatchObject({
    area: "West Tambaram",
    city: "Tambaram",
    pincode: "600045",
    lat: 12.9257923,
    lng: 80.1179194,
    source: "manual"
  });
});

test("announces when location suggestions use a simplified fallback query", async () => {
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) {
      return Promise.resolve(jsonResponse({
        locations: [{
          label: "Indiranagar, Bengaluru, India",
          area: "Indiranagar",
          city: "Bengaluru",
          country: "India",
          pincode: "560038",
          lat: 12.9716,
          lng: 77.5946,
          source: "manual"
        }],
        fallback: true,
        originalQuery: "12 MG Road, Indiranagar, Bengaluru"
      }));
    }
    return Promise.resolve(jsonResponse({ results: [], groups: [], comparison: null, intelligence: {} }));
  }));
  render(<App />);

  fireEvent.change(screen.getByLabelText(/Your location/), {
    target: { value: "12 MG Road, Indiranagar, Bengaluru" }
  });

  expect(await screen.findByText(
    "Showing nearby matches for 12 MG Road, Indiranagar, Bengaluru."
  )).toBeInTheDocument();
});

test("shows a friendly message when no location results are returned", async () => {
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) {
      return Promise.resolve(jsonResponse({ locations: [], fallback: false }));
    }
    return Promise.resolve(jsonResponse({ results: [], groups: [], comparison: null, intelligence: {} }));
  }));
  render(<App />);

  fireEvent.change(screen.getByLabelText(/Your location/), { target: { value: "Unknown place" } });

  expect(await screen.findByText(
    "No places found for 'Unknown place'. Try the area name or pincode."
  )).toBeInTheDocument();
  expect(screen.queryByRole("listbox", { name: "Location suggestions" })).not.toBeInTheDocument();
});

test("shows a retry action when the location service is unavailable", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) {
      attempts += 1;
      return Promise.resolve(attempts === 1
        ? { ok: false, status: 502, json: async () => ({ error: "upstream unavailable" }) }
        : jsonResponse({ locations: [], fallback: false }));
    }
    return Promise.resolve(jsonResponse({ results: [], groups: [], comparison: null, intelligence: {} }));
  }));
  render(<App />);

  fireEvent.change(screen.getByLabelText(/Your location/), { target: { value: "Tambaram" } });
  expect(await screen.findByText(
    "Location service unavailable. Check your internet and try again"
  )).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByText(
    "No places found for 'Tambaram'. Try the area name or pincode."
  )).toBeInTheDocument();
  expect(attempts).toBe(2);
});

test("ignores stale location suggestion responses after a newer query", async () => {
  let resolveFirst;
  let firstSignal;
  const fetchMock = vi.fn((url, options = {}) => {
    const query = new URL(String(url), "http://localhost").searchParams.get("q");
    if (query === "Old place") {
      firstSignal = options.signal;
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve(jsonResponse({
      locations: [{
        label: "New Place, Bengaluru, India",
        area: "New Place",
        city: "Bengaluru",
        country: "India",
        pincode: "560038",
        lat: 12.9716,
        lng: 77.5946,
        source: "manual"
      }]
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  const input = screen.getByLabelText(/Your location/);

  fireEvent.change(input, { target: { value: "Old place" } });
  await waitFor(() => expect(resolveFirst).toBeDefined());
  fireEvent.change(input, { target: { value: "New place" } });
  expect(await screen.findByRole("option", { name: /New Place, Bengaluru, 560038/ })).toBeInTheDocument();
  expect(firstSignal.aborted).toBe(true);

  resolveFirst(jsonResponse({
    locations: [{
      label: "Old Place, Bengaluru, India",
      area: "Old Place",
      city: "Bengaluru",
      country: "India",
      pincode: "560001",
      lat: 12.9716,
      lng: 77.5946,
      source: "manual"
    }]
  }));
  expect(screen.queryByRole("option", { name: /Old Place/ })).not.toBeInTheDocument();
});

test("reruns a search when the radius changes and sends the selected location", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) return Promise.resolve(manualLocationResponse());
    if (String(url).startsWith("/api/reverse-geocode")) return Promise.resolve(reverseGeocodeResponse(String(url)));
    if (String(url).startsWith("/api/suggest")) return Promise.resolve(jsonResponse({ suggestions: [] }));
    return Promise.resolve(jsonResponse({ results: [], groups: [], comparison: null, intelligence: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  await selectManualLocation(user);
  await user.click(screen.getByRole("button", { name: "Find my best pick" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/compare")
  )).toHaveLength(1));

  fireEvent.change(screen.getByRole("slider", { name: "Search radius" }), { target: { value: "10" } });
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/compare")
  )).toHaveLength(2));
  const compareUrls = fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/compare"));
  expect(compareUrls[0]).toContain("radiusKm=5");
  expect(compareUrls[1]).toContain("radiusKm=10");
  expect(compareUrls[1]).toContain("lat=12.9716");
  expect(compareUrls[1]).toContain("lng=77.5946");
});

test("confirms the clicked result before opening its sample shop search", async () => {
  const user = userEvent.setup();
  const popup = { opener: window };
  const open = vi.spyOn(window, "open").mockImplementation(() => popup);
  const option = {
    provider: "Zomato",
    app: "Zomato",
    restaurantId: "zomato-test-shop",
    shopId: "zomato-test-shop",
    restaurantName: "Test Shop",
    shopName: "Test Shop",
    dish: "Chicken Biryani",
    itemName: "Chicken Biryani",
    itemId: "zomato-test-shop-chicken-biryani",
    portion: "single",
    itemPrice: 200,
    price: 200,
    deliveryFee: 20,
    platformFee: 5,
    packagingFee: 5,
    gst: 10,
    discount: 0,
    finalTotal: 240,
    etaMinutes: 30,
    rating: 4.5,
    ratingCount: 100,
    distanceKm: 0.4,
    lat: 12.97,
    lng: 77.59,
    area: "Indiranagar",
    city: "Bengaluru",
    restaurantLocation: { lat: 12.97, lng: 77.59 },
    isOpen: true,
    isMock: true,
    isSampleData: true,
    lastUpdated: new Date().toISOString(),
    foodType: "non-veg",
    scoreBreakdown: { price: 90, rating: 90, delivery: 90, reliability: 90, distance: 90 },
    freeDeliveryAbove: 399,
    history30dAverage: 200,
    surgeFee: 0
  };
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) return Promise.resolve(manualLocationResponse());
    if (String(url).startsWith("/api/reverse-geocode")) return Promise.resolve(reverseGeocodeResponse(String(url)));
    if (String(url).startsWith("/api/suggest")) return Promise.resolve(jsonResponse({ suggestions: [] }));
    return Promise.resolve(jsonResponse({
      results: [option],
      groups: [{ restaurantName: "Test Shop", dish: "Chicken Biryani", portion: "single", options: [option] }],
      comparison: { portion: "single" },
      recommendation: { warnings: [] },
      intelligence: {},
      didYouMean: []
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const { container } = render(<App />);
  await selectManualLocation(user);
  await user.type(screen.getByLabelText("Optional shop name"), "Test Shop");
  await user.click(screen.getByRole("button", { name: "Find my best pick" }));
  await screen.findByRole("heading", { name: "Here’s the good stuff." });
  await user.click(screen.getByRole("checkbox", { name: "Apply coupons" }));
  await user.click(container.querySelector(".card-order"));

  const confirmation = await screen.findByRole("dialog", { name: "Confirm your choice" });
  expect(confirmation).toHaveTextContent(
    "You chose: Chicken Biryani from Test Shop on Zomato - ₹240"
  );
  expect(confirmation).toHaveTextContent("Delivery to: Indiranagar, Bengaluru, India");
  expect(confirmation).toHaveTextContent(
    "If Zomato shows different details, search for Test Shop and add Chicken Biryani."
  );
  expect(confirmation).toHaveTextContent("Sample data — this opens search results, not a confirmed order.");
  expect(within(confirmation).getByRole("button", { name: "Copy shop name" })).toBeVisible();
  expect(within(confirmation).getByRole("button", { name: "Copy item name" })).toBeVisible();
  await user.click(within(confirmation).getByRole("button", { name: "Open Zomato" }));

  expect(open).toHaveBeenCalledWith(
    "https://www.zomato.com/search?query=Test%20Shop%20Indiranagar%2C%20Bengaluru%2C%20India",
    "_blank"
  );
  expect(popup.opener).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) =>
    String(url).startsWith("/api/compare") && String(url).includes("shopName=Test+Shop")
  )).toBe(true);
});

test("the fifth visible result keeps its shop and item after changing the sort priority", async () => {
  const user = userEvent.setup();
  const open = vi.spyOn(window, "open").mockImplementation(() => ({ opener: window }));
  const apps = ["Zomato", "Swiggy", "Toing", "Zomato", "Swiggy"];
  const options = apps.map((app, index) => ({
    app,
    provider: app,
    shopId: `${app.toLowerCase()}-shop-${index + 1}`,
    restaurantId: `${app.toLowerCase()}-shop-${index + 1}`,
    shopName: `Shop ${index + 1}`,
    restaurantName: `Shop ${index + 1}`,
    itemId: `${app.toLowerCase()}-item-${index + 1}`,
    itemName: `Chicken Fried Rice ${index + 1}`,
    dish: `Chicken Fried Rice ${index + 1}`,
    price: 200 + index,
    itemPrice: 200 + index,
    deliveryFee: 20,
    platformFee: 5,
    packagingFee: 5,
    gst: 10,
    discount: 0,
    finalTotal: 240 + index,
    etaMinutes: 30 + index,
    rating: 4.5,
    ratingCount: 100,
    distanceKm: 0.4,
    lat: 12.97,
    lng: 77.59,
    area: "Indiranagar",
    city: "Bengaluru",
    restaurantLocation: { lat: 12.97, lng: 77.59 },
    isOpen: true,
    isMock: true,
    isSampleData: true,
    portion: "single",
    lastUpdated: new Date().toISOString(),
    foodType: "non-veg",
    scoreBreakdown: { price: 90, rating: 90, delivery: 90, reliability: 90, distance: 90 }
  }));
  const groups = options.map((option) => ({
    restaurantName: option.shopName,
    dish: option.itemName,
    portion: option.portion,
    options: [option]
  }));
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) return Promise.resolve(manualLocationResponse());
    if (String(url).startsWith("/api/reverse-geocode")) return Promise.resolve(reverseGeocodeResponse(String(url)));
    if (String(url).startsWith("/api/suggest")) return Promise.resolve(jsonResponse({ suggestions: [] }));
    return Promise.resolve(jsonResponse({
      results: options,
      groups,
      comparison: { portion: "single" },
      recommendation: { warnings: [] },
      intelligence: {},
      didYouMean: []
    }));
  }));

  const { container } = render(<App />);
  await selectManualLocation(user);
  await user.click(screen.getByRole("button", { name: "Find my best pick" }));
  await screen.findByRole("heading", { name: "Here’s the good stuff." });
  await user.click(screen.getByRole("checkbox", { name: "Apply coupons" }));
  await user.click(screen.getByRole("button", { name: "Fastest" }));

  const visibleOrderButtons = container.querySelectorAll(".card-order");
  expect(visibleOrderButtons).toHaveLength(5);
  await user.click(visibleOrderButtons[4]);

  const confirmation = await screen.findByRole("dialog", { name: "Confirm your choice" });
  expect(confirmation).toHaveTextContent(
    "You chose: Chicken Fried Rice 5 from Shop 5 on Swiggy - ₹244"
  );
  await user.click(within(confirmation).getByRole("button", { name: "Open Swiggy" }));
  expect(open).toHaveBeenCalledWith(
    "https://www.swiggy.com/search?query=Shop%205%20Indiranagar%2C%20Bengaluru%2C%20India",
    "_blank"
  );
});

test("requires a confirmed location and automatically searches again after manual selection changes", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url) => {
    if (String(url).startsWith("/api/location-suggest")) {
      if (String(url).includes("Chennai")) return Promise.resolve(manualLocationResponse("Pallavaram, Chennai, India", 13.0827, 80.2707));
      return Promise.resolve(manualLocationResponse());
    }
    if (String(url).startsWith("/api/reverse-geocode")) {
      const location = String(url).includes("13.0827")
        ? "Pallavaram, Chennai, India"
        : "Indiranagar, Bengaluru, India";
      return Promise.resolve(reverseGeocodeResponse(String(url), location));
    }
    if (String(url).startsWith("/api/suggest")) return Promise.resolve(jsonResponse({ suggestions: [] }));
    return Promise.resolve(jsonResponse({
      results: [], comparison: null, groups: [], intelligence: {}, location: { areaName: "Bengaluru" }
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Find my best pick" }));
  expect(await screen.findByText(/Please choose your location/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/compare"))).toBe(false);

  await selectManualLocation(user);
  await user.click(screen.getByRole("button", { name: "Find my best pick" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/compare")
  )).toHaveLength(1));

  await selectManualLocation(user, "Pallavaram, Chennai, India");
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/compare")
  )).toHaveLength(2));
  expect(fetchMock.mock.calls.some(([url]) =>
    String(url).includes("lat=13.0827") && String(url).includes("lng=80.2707") &&
    String(url).includes("area=Pallavaram") && String(url).includes("city=Chennai")
  )).toBe(true);
});
