import { describe, it, expect } from 'vitest';
import { renderSettingRow } from './setting-row';

describe('components/setting-row', () => {
  it('renders label and optional description', () => {
    const el = renderSettingRow(document, { label: 'Vault path', description: 'Where notes live' });
    expect(el.className).toBe('sauce-setting-row');
    expect(el.querySelector('.sauce-setting-row__label')?.textContent).toBe('Vault path');
    expect(el.querySelector('.sauce-setting-row__description')?.textContent).toBe('Where notes live');
  });

  it('omits the description row when not provided', () => {
    const el = renderSettingRow(document, { label: 'Solo' });
    expect(el.querySelector('.sauce-setting-row__description')).toBeNull();
  });

  it('zero-literals gate: every inline style value is a var(--token)', () => {
    const el = renderSettingRow(document, { label: 'L', description: 'D' });
    for (const node of [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]) {
      for (let i = 0; i < node.style.length; i++) {
        expect(node.style.getPropertyValue(node.style[i]!)).toMatch(/^var\(--/); // safe: i < node.style.length
      }
    }
  });
});
