"use client";

import { useSyncExternalStore } from "react";
import { COMPACT_MEDIA_QUERY } from "@/lib/breakpoints";

// Compact breakpoint shared with app/globals.css (max-width: 1023px).
// Phones, iPad mini, and iPad portrait use the overlay-drawer shell.

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(COMPACT_MEDIA_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(COMPACT_MEDIA_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport is at or below the compact breakpoint
 * (phone, iPad mini, iPad portrait). SSR-safe: renders as desktop (false)
 * on the server and first client paint, then syncs after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
