import { describe, it, expect } from 'vitest';
import { toBase64, fromBase64 } from './arraybuffer-base64';

function bytes(...n: number[]): ArrayBuffer {
  return new Uint8Array(n).buffer;
}

describe('helpers/arraybuffer-base64', () => {
  it('encodes bytes to base64', () => {
    // "Hi" = [72, 105] -> "SGk="
    expect(toBase64(bytes(72, 105))).toBe('SGk=');
  });

  it('decodes base64 to bytes', () => {
    expect(Array.from(new Uint8Array(fromBase64('SGk=')))).toEqual([72, 105]);
  });

  it('round-trips arbitrary bytes', () => {
    const original = bytes(0, 1, 127, 128, 255, 42);
    const round = new Uint8Array(fromBase64(toBase64(original)));
    expect(Array.from(round)).toEqual([0, 1, 127, 128, 255, 42]);
  });
});
