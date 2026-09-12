"use client";

import { useSyncExternalStore } from "react";

export interface MotionPreferences {
  enabled: boolean;
  chatBorderBeam: boolean;
  beamSpeed: number;
  ompBouncing: boolean;
  thinkingPulse: boolean;
}

export const DEFAULT_MOTION_PREFS: MotionPreferences = {
  enabled: true,
  chatBorderBeam: true,
  beamSpeed: 5.5,
  ompBouncing: true,
  thinkingPulse: true,
};

const STORAGE_KEY = "omp-motion-prefs";
const listeners = new Set<() => void>();

let cachedPrefs: MotionPreferences = DEFAULT_MOTION_PREFS;
let initialized = false;

export function applyMotionPrefsToDom(prefs: MotionPreferences) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-animations", prefs.enabled ? "true" : "false");
  root.setAttribute("data-animation-beam", prefs.enabled && prefs.chatBorderBeam ? "true" : "false");
  root.setAttribute("data-animation-omp", prefs.enabled && prefs.ompBouncing ? "true" : "false");
  root.setAttribute("data-animation-thinking", prefs.enabled && prefs.thinkingPulse ? "true" : "false");
  root.style.setProperty("--omp-beam-speed", `${prefs.beamSpeed}s`);
}

export function getMotionPrefs(): MotionPreferences {
  if (typeof window === "undefined") return cachedPrefs;
  if (!initialized) {
    initialized = true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) cachedPrefs = { ...DEFAULT_MOTION_PREFS, ...JSON.parse(saved) };
    } catch {
      // Keep defaults when storage is unreadable.
    }
    applyMotionPrefsToDom(cachedPrefs);
  }
  return cachedPrefs;
}

export function saveMotionPrefs(updated: Partial<MotionPreferences>): void {
  cachedPrefs = { ...cachedPrefs, ...updated };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedPrefs));
  } catch {
    // Motion prefs remain usable without persistence.
  }
  applyMotionPrefsToDom(cachedPrefs);
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useMotionPrefs() {
  const prefs = useSyncExternalStore(subscribe, getMotionPrefs, () => DEFAULT_MOTION_PREFS);
  return { motionPrefs: prefs, setMotionPrefs: saveMotionPrefs };
}
