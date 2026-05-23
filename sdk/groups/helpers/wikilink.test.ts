import { describe, it, expect } from 'vitest';
import { isWikilink, parseWikilink, formatWikilink } from './wikilink';

describe('helpers/wikilink', () => {
  it('detects wikilinks', () => {
    expect(isWikilink('[[Note]]')).toBe(true);
    expect(isWikilink('Note')).toBe(false);
    expect(isWikilink(42)).toBe(false);
  });

  it('parses target only', () => {
    expect(parseWikilink('[[People/Frank]]')).toEqual({ target: 'People/Frank' });
  });

  it('parses target + heading + alias', () => {
    expect(parseWikilink('[[Note#Section|Display]]')).toEqual({
      target: 'Note',
      heading: 'Section',
      alias: 'Display',
    });
  });

  it('returns null for non-wikilinks', () => {
    expect(parseWikilink('not a link')).toBeNull();
  });

  it('formats parts back to a wikilink', () => {
    expect(formatWikilink({ target: 'Note', heading: 'S', alias: 'A' })).toBe('[[Note#S|A]]');
    expect(formatWikilink({ target: 'Note' })).toBe('[[Note]]');
    expect(formatWikilink({ target: '' })).toBe('');
  });

  it('round-trips canonical input', () => {
    for (const link of ['[[A]]', '[[A#B]]', '[[A|C]]', '[[A#B|C]]']) {
      expect(formatWikilink(parseWikilink(link)!)).toBe(link);
    }
  });
});
