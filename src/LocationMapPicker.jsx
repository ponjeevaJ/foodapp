import React, { useEffect } from "react";
import { Icon } from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { Circle as LeafletCircle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { hasGoogleMapsApiKey, loadGoogleMapsApi } from "./googleMaps.js";

const TAMIL_NADU_BOUNDS = [[8.0, 76.2], [13.6, 80.4]];

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    }
  });
  return null;
}

function MapStateUpdater({ center, selectedPoint }) {
  const map = useMap();

  useEffect(() => {
    map.setView([center.lat, center.lng], selectedPoint ? 14 : 12);
  }, [center, map, selectedPoint]);

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize({ pan: false }), 0);
    return () => clearTimeout(timer);
  }, [map]);

  return null;
}

const locationPinIcon = new Icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export default function LocationMapPicker({ center, selectedPoint, onPick }) {
  if (hasGoogleMapsApiKey()) {
    return <GoogleMapPicker center={center} selectedPoint={selectedPoint} onPick={onPick} />;
  }

  return <OpenStreetMapPicker center={center} selectedPoint={selectedPoint} onPick={onPick} />;
}

function OpenStreetMapPicker({ center, selectedPoint, onPick }) {
  const accuracy = Number(selectedPoint?.accuracyMeters);

  return (
    <MapContainer
      className="location-map"
      center={[center.lat, center.lng]}
      zoom={selectedPoint ? 14 : 12}
      minZoom={7}
      maxBounds={TAMIL_NADU_BOUNDS}
      maxBoundsViscosity={1}
      scrollWheelZoom
    >
      <MapStateUpdater center={center} selectedPoint={selectedPoint} />
      <TileLayer
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickHandler onPick={onPick} />
      {selectedPoint && Number.isFinite(accuracy) && accuracy > 0 && (
        <LeafletCircle
          center={[selectedPoint.lat, selectedPoint.lng]}
          radius={accuracy}
          pathOptions={{ color: "#347b50", fillColor: "#347b50", fillOpacity: 0.12 }}
        />
      )}
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

function GoogleMapPicker({ center, selectedPoint, onPick }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const markerRef = React.useRef(null);
  const accuracyCircleRef = React.useRef(null);
  const onPickRef = React.useRef(onPick);
  const centerRef = React.useRef(center);
  const selectedPointRef = React.useRef(selectedPoint);
  const [mapError, setMapError] = React.useState("");

  centerRef.current = center;
  selectedPointRef.current = selectedPoint;

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let active = true;
    let mapClickListener;
    let markerDragListener;
    loadGoogleMapsApi().then((maps) => {
      if (!active || !containerRef.current) return;
      const currentCenter = centerRef.current;
      const currentSelection = selectedPointRef.current;
      const map = new maps.Map(containerRef.current, {
        center: { lat: currentCenter.lat, lng: currentCenter.lng },
        zoom: currentSelection ? 14 : 12,
        minZoom: 7,
        restriction: {
          latLngBounds: {
            north: TAMIL_NADU_BOUNDS[1][0],
            south: TAMIL_NADU_BOUNDS[0][0],
            east: TAMIL_NADU_BOUNDS[1][1],
            west: TAMIL_NADU_BOUNDS[0][1]
          },
          strictBounds: true
        },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      });
      mapRef.current = map;
      const marker = new maps.Marker({
        map: currentSelection ? map : null,
        position: currentSelection
          ? { lat: currentSelection.lat, lng: currentSelection.lng }
          : { lat: currentCenter.lat, lng: currentCenter.lng },
        draggable: true
      });
      markerRef.current = marker;
      mapClickListener = map.addListener("click", (event) => {
        if (!event.latLng) return;
        const point = { lat: event.latLng.lat(), lng: event.latLng.lng() };
        marker.setMap(map);
        marker.setPosition(point);
        onPickRef.current(point);
      });
      markerDragListener = marker.addListener("dragend", (event) => {
        const latLng = event.latLng || marker.getPosition();
        if (!latLng) return;
        onPickRef.current({ lat: latLng.lat(), lng: latLng.lng() });
      });
      setMapError("");
      setTimeout(() => {
        if (active) maps.event.trigger(map, "resize");
      }, 0);
    }).catch((error) => {
      if (!active) return;
      setMapError(error.message);
    });

    return () => {
      active = false;
      const maps = window.google?.maps;
      if (mapClickListener) maps?.event?.removeListener(mapClickListener);
      if (markerDragListener) maps?.event?.removeListener(markerDragListener);
      markerRef.current?.setMap(null);
      accuracyCircleRef.current?.setMap(null);
      mapRef.current = null;
      markerRef.current = null;
      accuracyCircleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const maps = window.google?.maps;
    if (!map || !marker || !maps) return;
    const point = { lat: center.lat, lng: center.lng };
    map.setCenter(point);
    map.setZoom(selectedPoint ? 14 : 12);
    if (selectedPoint) {
      marker.setMap(map);
      marker.setPosition({ lat: selectedPoint.lat, lng: selectedPoint.lng });
      const accuracy = Number(selectedPoint.accuracyMeters);
      if (Number.isFinite(accuracy) && accuracy > 0) {
        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = new maps.Circle({
            map,
            strokeColor: "#347b50",
            fillColor: "#347b50",
            fillOpacity: 0.12,
            strokeOpacity: 0.8,
            strokeWeight: 1
          });
        }
        accuracyCircleRef.current.setCenter(point);
        accuracyCircleRef.current.setRadius(accuracy);
      } else {
        accuracyCircleRef.current?.setMap(null);
        accuracyCircleRef.current = null;
      }
    } else {
      marker.setMap(null);
      accuracyCircleRef.current?.setMap(null);
      accuracyCircleRef.current = null;
    }
  }, [center, selectedPoint]);

  if (mapError) {
    return (
      <div className="google-map-fallback">
        <p className="google-map-error" role="alert">
          {mapError} Using OpenStreetMap so you can still select a point.
        </p>
        <OpenStreetMapPicker center={center} selectedPoint={selectedPoint} onPick={onPick} />
      </div>
    );
  }

  return (
    <div className="location-map google-location-map" ref={containerRef}>
    </div>
  );
}
