import { TbFillCircle, TbFillSquare } from "solid-icons/tb";
import * as tauriGeolocation from "@tauri-apps/plugin-geolocation";
import "./RecordButton.css";
import { isMobilePlatform } from "../lib/platform";
import {
  addPoint,
  clearTrack,
  isRecording,
  setIsRecording,
} from "../stores/recording";

let watchId: number | null = null;

async function startTauriWatch() {
  let status = await tauriGeolocation.checkPermissions();
  if (status.location !== "granted") {
    status = await tauriGeolocation.requestPermissions(["location"]);
  }
  if (status.location !== "granted") {
    throw new Error("Location permission denied");
  }
  watchId = await tauriGeolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    (pos, err) => {
      if (err || !pos) return;
      addPoint({
        lng: pos.coords.longitude,
        lat: pos.coords.latitude,
        timestamp: pos.timestamp ?? Date.now(),
      });
    },
  );
}

function startBrowserWatch() {
  if (!navigator.geolocation) throw new Error("Geolocation not supported");
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      addPoint({
        lng: pos.coords.longitude,
        lat: pos.coords.latitude,
        timestamp: pos.timestamp,
      });
    },
    (err) => console.warn("GPS error:", err),
    { enableHighAccuracy: true },
  );
}

async function stopWatch() {
  if (watchId === null) return;
  if (isMobilePlatform) {
    await tauriGeolocation.clearWatch(watchId);
  } else {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
}

async function handleToggle() {
  if (isRecording()) {
    await stopWatch();
    setIsRecording(false);
  } else {
    clearTrack();
    try {
      if (isMobilePlatform) {
        await startTauriWatch();
      } else {
        startBrowserWatch();
      }
      setIsRecording(true);
    } catch (e) {
      console.error("Failed to start recording:", e);
    }
  }
}

function RecordButton() {
  return (
    <button
      class="record-btn"
      data-recording={isRecording() ? "" : undefined}
      onClick={handleToggle}
      title={isRecording() ? "Stop recording" : "Start recording"}
    >
      {isRecording() ? (
        <TbFillSquare size={32} color="#ef4444" />
      ) : (
        <TbFillCircle size={68} color="#ef4444" />
      )}
    </button>
  );
}

export default RecordButton;
