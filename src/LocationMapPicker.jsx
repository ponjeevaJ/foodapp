import React, { useEffect } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      onPick(point);
    }
  });
  return null;
}

function MapCenterUpdater({ center, selectedPoint }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], selectedPoint ? 14 : 2);
  }, [center, map, selectedPoint]);
  return null;
}

const locationPinIcon = divIcon({
  className: "location-pin-icon",
  html: "<span></span>",
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

export default function LocationMapPicker({ center, selectedPoint, onPick }) {
  return (
    <MapContainer
      className="location-map"
      center={[center.lat, center.lng]}
      zoom={selectedPoint ? 14 : 2}
      scrollWheelZoom
    >
      <MapCenterUpdater center={center} selectedPoint={selectedPoint} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickHandler onPick={onPick} />
      {selectedPoint && (
        <Marker
          position={[selectedPoint.lat, selectedPoint.lng]}
          icon={locationPinIcon}
          draggable
          eventHandlers={{
            dragend(event) {
              const { lat, lng } = event.target.getLatLng();
              onPick({ lat, lng });
            }
          }}
        />
      )}
    </MapContainer>
  );
}
