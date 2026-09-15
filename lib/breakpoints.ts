/** Shared viewport breakpoints. Keep these in sync with `app/globals.css`.
 *
 * Compact (drawer sidebar, 40px touch targets) covers phones and tablets in
 * portrait: iPhone (~390), iPad mini (744), iPad (820–834). Landscape iPad
 * (1024+) uses the persistent desktop sidebar.
 *
 * Phone is the tighter subset used only for extra chrome compression. */
export const PHONE_MAX_WIDTH = 640;
export const COMPACT_MAX_WIDTH = 1023;

export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
export const COMPACT_MEDIA_QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${COMPACT_MAX_WIDTH + 1}px)`;
