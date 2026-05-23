import { describe, it, expect, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { isDesktopApp, isMobileApp, isIos, isAndroid, isPhone } from './platform-detect';
import { hasApiSymbol } from '../../generated/api-catalog';

// Snapshot + restore the mutable stub Platform so tests don't leak state.
const snapshot = { ...Platform };
afterEach(() => {
  Object.assign(Platform, snapshot);
});

describe('tools/platform-detect', () => {
  it('reflects desktop defaults', () => {
    expect(isDesktopApp()).toBe(true);
    expect(isMobileApp()).toBe(false);
  });

  it('reflects a mobile/iOS device when Platform flips', () => {
    Object.assign(Platform, { isDesktopApp: false, isMobileApp: true, isIosApp: true, isPhone: true });
    expect(isDesktopApp()).toBe(false);
    expect(isMobileApp()).toBe(true);
    expect(isIos()).toBe(true);
    expect(isAndroid()).toBe(false);
    expect(isPhone()).toBe(true);
  });

  it('catalog-validation gate: obsidian_api Platform exists in the generated catalog', () => {
    expect(hasApiSymbol('Platform')).toBe(true);
  });
});
