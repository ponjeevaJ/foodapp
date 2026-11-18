import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGooglePlaceLocation,
  googleStatusMessage,
  reverseGeocodeGoogle,
  searchGooglePlaces
} from "../src/googleMaps.js";

const originalGoogle = window.google;

function installGoogle(maps) {
  window.google = { maps: { Map: function Map() {}, places: {}, ...maps } };
  return window.google.maps;
}

function addressComponents() {
  return [
    { long_name: "T. Nagar", types: ["neighborhood"] },
    { long_name: "Chennai", types: ["locality"] },
    { long_name: "Chennai district", types: ["administrative_area_level_2"] },
    { long_name: "Tamil Nadu", types: ["administrative_area_level_1"] },
    { long_name: "India", types: ["country"] },
    { long_name: "600017", types: ["postal_code"] }
  ];
}

afterEach(() => {
  if (originalGoogle === undefined) delete window.google;
  else window.google = originalGoogle;
});

describe("Google Maps location helpers", () => {
  it("reverse geocodes the exact latitude and longitude and extracts address fields", async () => {
    let request;
    const maps = installGoogle({
      GeocoderStatus: { OK: "OK" },
      Geocoder: vi.fn(function Geocoder() {
        return {
          geocode(value, callback) {
            request = value;
            callback([{
              formatted_address: "T. Nagar, Chennai, Tamil Nadu, India",
              address_components: addressComponents()
            }], "OK");
          }
        };
      })
    });

    const location = await reverseGeocodeGoogle(13.0418, 80.2337);

    expect(request).toEqual({ location: { lat: 13.0418, lng: 80.2337 } });
    expect(location).toMatchObject({
      lat: 13.0418,
      lng: 80.2337,
      address: "T. Nagar, Chennai, Tamil Nadu, India",
      area: "T. Nagar",
      city: "Chennai",
      district: "Chennai district",
      pincode: "600017",
      state: "Tamil Nadu",
      country: "India"
    });
    expect(maps.Geocoder).toHaveBeenCalledTimes(1);
  });

  it("uses Tamil Nadu bounds and returns Google Places predictions", async () => {
    let request;
    installGoogle({
      LatLng: function LatLng(lat, lng) { this.lat = lat; this.lng = lng; },
      LatLngBounds: function LatLngBounds(southWest, northEast) {
        this.southWest = southWest;
        this.northEast = northEast;
      },
      places: {
        PlacesServiceStatus: { OK: "OK", ZERO_RESULTS: "ZERO_RESULTS" },
        AutocompleteService: function AutocompleteService() {
          return {
            getPlacePredictions(value, callback) {
              request = value;
              callback([{
                place_id: "place-1",
                description: "T. Nagar, Chennai, Tamil Nadu, India",
                structured_formatting: {
                  main_text: "T. Nagar",
                  secondary_text: "Chennai, Tamil Nadu, India"
                }
              }], "OK");
            }
          };
        }
      }
    });

    const places = await searchGooglePlaces("T. Nagar");

    expect(request).toMatchObject({
      input: "T. Nagar",
      componentRestrictions: { country: "in" },
      strictBounds: true,
      types: ["geocode"]
    });
    expect(request.bounds.southWest).toMatchObject({ lat: 8, lng: 76.2 });
    expect(request.bounds.northEast).toMatchObject({ lat: 13.6, lng: 80.4 });
    expect(places[0]).toMatchObject({
      placeId: "place-1",
      label: "T. Nagar, Chennai, Tamil Nadu, India",
      area: "T. Nagar"
    });
  });

  it("resolves a selected Places result to numeric coordinates and address components", async () => {
    installGoogle({
      places: {
        PlacesServiceStatus: { OK: "OK" },
        PlacesService: function PlacesService() {
          return {
            getDetails(request, callback) {
              expect(request.placeId).toBe("place-1");
              callback({
                formatted_address: "T. Nagar, Chennai, Tamil Nadu, India",
                address_components: addressComponents(),
                geometry: { location: { lat: () => 13.0418, lng: () => 80.2337 } }
              }, "OK");
            }
          };
        }
      }
    });

    await expect(getGooglePlaceLocation("place-1")).resolves.toMatchObject({
      lat: 13.0418,
      lng: 80.2337,
      address: "T. Nagar, Chennai, Tamil Nadu, India",
      city: "Chennai",
      pincode: "600017"
    });
  });

  it("provides an actionable message for Google API denial", () => {
    const error = googleStatusMessage("REQUEST_DENIED");
    expect(error.code).toBe("REQUEST_DENIED");
    expect(error.message).toMatch(/billing.*Maps JavaScript API.*Geocoding API.*Places API/i);
  });
});
