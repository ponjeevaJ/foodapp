import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const mapState = vi.hoisted(() => ({
  handlers: null,
  mapProps: null,
  tileProps: null,
  markerProps: null,
  mapApi: { setView: vi.fn(), invalidateSize: vi.fn() }
}));

vi.mock("react-leaflet", () => ({
  MapContainer: (props) => {
    mapState.mapProps = props;
    return (
      <div data-testid="map-center" data-center={JSON.stringify(props.center)}>
        {props.children}
        <button
          type="button"
          onClick={() => mapState.handlers.click({ latlng: { lat: 12.34567, lng: 77.12345 } })}
        >
          Simulate map click
        </button>
      </div>
    );
  },
  Marker: (props) => {
    mapState.markerProps = props;
    return (
      <button
        type="button"
        data-position={JSON.stringify(props.position)}
        onClick={() => props.eventHandlers.dragend({
          target: { getLatLng: () => ({ lat: 12.34678, lng: 77.12456 }) }
        })}
      >
        Simulate marker drag
      </button>
    );
  },
  Circle: ({ center, radius }) => (
    <span data-testid="accuracy-circle" data-center={JSON.stringify(center)} data-radius={radius} />
  ),
  TileLayer: (props) => {
    mapState.tileProps = props;
    return null;
  },
  useMap: () => mapState.mapApi,
  useMapEvents: (handlers) => {
    mapState.handlers = handlers;
  }
}));

import LocationMapPicker from "../src/LocationMapPicker.jsx";

test("uses OSM tiles, Tamil Nadu bounds, and a visible accessible attribution", async () => {
  const onPick = vi.fn();
  render(
    <LocationMapPicker
      center={{ lat: 13.0827, lng: 80.2707 }}
      selectedPoint={null}
      onPick={onPick}
    />
  );

  expect(screen.getByTestId("map-center")).toHaveAttribute("data-center", "[13.0827,80.2707]");
  expect(mapState.mapProps.zoom).toBe(12);
  expect(mapState.mapProps.minZoom).toBe(7);
  expect(mapState.mapProps.maxBounds).toEqual([[8, 76.2], [13.6, 80.4]]);
  expect(mapState.tileProps.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  expect(mapState.tileProps.attribution).toBe(
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  );
  await waitFor(() => expect(mapState.mapApi.invalidateSize).toHaveBeenCalledWith({ pan: false }));
});

test("keeps Leaflet center, click, and marker-drag coordinates in lat/lng order", () => {
  const onPick = vi.fn();
  render(
    <LocationMapPicker
      center={{ lat: 12.3, lng: 80.4 }}
      selectedPoint={{ lat: 12.3, lng: 80.4, accuracyMeters: 75 }}
      onPick={onPick}
    />
  );

  expect(screen.getByTestId("map-center")).toHaveAttribute("data-center", "[12.3,80.4]");
  expect(mapState.mapProps.zoom).toBe(14);
  expect(screen.getByTestId("accuracy-circle")).toHaveAttribute("data-center", "[12.3,80.4]");
  expect(screen.getByTestId("accuracy-circle")).toHaveAttribute("data-radius", "75");
  expect(mapState.markerProps.icon.options.iconUrl).toContain("marker-icon");

  fireEvent.click(screen.getByRole("button", { name: "Simulate map click" }));
  expect(onPick).toHaveBeenLastCalledWith({ lat: 12.34567, lng: 77.12345 });

  fireEvent.click(screen.getByRole("button", { name: "Simulate marker drag" }));
  expect(onPick).toHaveBeenLastCalledWith({ lat: 12.34678, lng: 77.12456 });
});
