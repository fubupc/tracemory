import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { onMount, onCleanup } from "solid-js";
import * as tauriGeolocation from "@tauri-apps/plugin-geolocation";

const DEFAULT_CENTER: [number, number] = [116.4, 39.9];
const DEFAULT_ZOOM = 12;

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

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
  if (isTauri()) {
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

    try {
      const center = await getUserPosition();
      map.setCenter(center);
      new maplibregl.Marker().setLngLat(center).addTo(map);
    } catch (e) {
      console.warn("Failed to get user position, using default:", e);
    }
  });

  onCleanup(() => map?.remove());

  return <div ref={container} style={{ width: "100%", height: "100vh" }} />;
}

export default MapView;
