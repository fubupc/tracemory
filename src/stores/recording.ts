import { createSignal } from "solid-js";

export interface GpsPoint {
  lng: number;
  lat: number;
  timestamp: number;
}

export const [isRecording, setIsRecording] = createSignal(false);
export const [trackPoints, setTrackPoints] = createSignal<GpsPoint[]>([]);

export function addPoint(point: GpsPoint) {
  setTrackPoints((prev) => [...prev, point]);
}

export function clearTrack() {
  setTrackPoints([]);
}
