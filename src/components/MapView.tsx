import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createEffect, onCleanup, onMount } from "solid-js";
import * as tauriGeolocation from "@tauri-apps/plugin-geolocation";
import { isMobilePlatform } from "../lib/platform";
import { trackPoints } from "../stores/recording";

const DEFAULT_CENTER: [number, number] = [116.4, 39.9];
const DEFAULT_ZOOM = 12;

async function getTauriPosition(): Promise<[number, number]> {
  let status = await tauriGeolocation.checkPermissions();
  if (status.location !== "granted") {
    status = await tauriGeolocation.requestPermissions(["location"]);
  }
  if (status.location !== "granted") {
    throw new Error("Location permission denied");
  }
  const pos = await tauriGeolocation.getCurrentPosition();
  return [pos.coords.longitude, pos.coords.latitude];
}

function getBrowserPosition(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
      (err) => reject(err),
    );
  });
}

async function getUserPosition(): Promise<[number, number]> {
  if (isMobilePlatform) {
    return getTauriPosition();
  }
  return getBrowserPosition();
}

function MapView() {
  let container!: HTMLDivElement;
  let map: maplibregl.Map;

  onMount(async () => {
    map = new maplibregl.Map({
      container,
      style: "https://tiles.openfreemap.org/styles/bright",
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#ef4444",
          "line-width": 4,
          "line-opacity": 0.85,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });
    });

    try {
      const center = await getUserPosition();
      map.setCenter(center);
      new maplibregl.Marker().setLngLat(center).addTo(map);
    } catch (e) {
      console.warn("Failed to get user position, using default:", e);
    }
  });

  createEffect(() => {
    const points = trackPoints();
    if (!map || !map.getSource("track")) return;

    const source = map.getSource("track") as maplibregl.GeoJSONSource;
    if (points.length < 2) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    source.setData({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: points.map((p) => [p.lng, p.lat]),
      },
      properties: {},
    });

    // Pan to latest point while recording
    const last = points[points.length - 1];
    map.panTo([last.lng, last.lat]);
  });

  onCleanup(() => map?.remove());

  return <div ref={container} style={{ width: "100%", height: "100vh" }} />;
}

export default MapView;
