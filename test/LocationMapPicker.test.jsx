import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const mapState = vi.hoisted(() => ({ handlers: null }));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, center }) => (
    <div data-testid="map-center" data-center={JSON.stringify(center)}>
      <button
        type="button"
        onClick={() => mapState.handlers.click({ latlng: { lat: 12.34567, lng: 77.12345 } })}
      >
        Simulate map click
      </button>
      {children}
    </div>
  ),
  Marker: ({ position, eventHandlers }) => (
    <button
      type="button"
      data-position={JSON.stringify(position)}
      onClick={() => eventHandlers.dragend({
        target: { getLatLng: () => ({ lat: 12.34678, lng: 77.12456 }) }
      })}
    >
      Simulate marker drag
    </button>
  ),
  TileLayer: () => null,
  useMap: () => ({ setView: vi.fn() }),
  useMapEvents: (handlers) => {
    mapState.handlers = handlers;
  }
}));

import LocationMapPicker from "../src/LocationMapPicker.jsx";

test("keeps Leaflet center, click, and marker-drag coordinates in lat/lng order", () => {
  const onPick = vi.fn();
  render(
    <LocationMapPicker
      center={{ lat: 12.3, lng: 80.4 }}
      selectedPoint={{ lat: 12.3, lng: 80.4 }}
      onPick={onPick}
    />
  );

  expect(screen.getByTestId("map-center")).toHaveAttribute("data-center", "[12.3,80.4]");
  fireEvent.click(screen.getByRole("button", { name: "Simulate map click" }));
  expect(onPick).toHaveBeenLastCalledWith({ lat: 12.34567, lng: 77.12345 });

  fireEvent.click(screen.getByRole("button", { name: "Simulate marker drag" }));
  expect(onPick).toHaveBeenLastCalledWith({ lat: 12.34678, lng: 77.12456 });
});
