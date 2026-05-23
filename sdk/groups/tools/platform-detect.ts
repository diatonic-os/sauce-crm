// SDK tool — source: sdk/groups/tools/platform-detect.md | api_version: 1.8.0 | gen_hash: hand-t001
//
// Wraps Obsidian Platform. The gate for MOBILE-FORK.md native/WASM selection.

import { Platform } from 'obsidian';

/** True on the desktop (Electron) app — guards native `require()` paths. */
export function isDesktopApp(): boolean {
  return Platform.isDesktopApp;
}

/** True on the mobile (Capacitor) app. */
export function isMobileApp(): boolean {
  return Platform.isMobileApp;
}

/** True on iOS specifically. */
export function isIos(): boolean {
  return Platform.isIosApp;
}

/** True on Android specifically. */
export function isAndroid(): boolean {
  return Platform.isAndroidApp;
}

/** True on a phone-form-factor device (smaller layout). */
export function isPhone(): boolean {
  return Platform.isPhone;
}
