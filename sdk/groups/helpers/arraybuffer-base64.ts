// SDK helper — source: sdk/groups/helpers/arraybuffer-base64.md | api_version: 1.8.0 | gen_hash: hand-0007
//
// Binary <-> base64 via Obsidian's host implementation (no Node Buffer; mobile-safe).

import { arrayBufferToBase64, base64ToArrayBuffer } from 'obsidian';

/** Encode an ArrayBuffer to a base64 string (host implementation). */
export function toBase64(buf: ArrayBuffer): string {
  return arrayBufferToBase64(buf);
}

/** Decode a base64 string to an ArrayBuffer (host implementation). */
export function fromBase64(b64: string): ArrayBuffer {
  return base64ToArrayBuffer(b64);
}
