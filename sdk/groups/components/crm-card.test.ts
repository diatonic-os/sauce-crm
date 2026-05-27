import { describe, it, expect } from 'vitest';
import { renderCrmCard } from './crm-card';

describe('components/crm-card', () => {
  it('renders name and subtitle rows', () => {
    const el = renderCrmCard(document, { name: 'Frank', subtitle: 'Acme Corp' });
    expect(el.className).toBe('sauce-crm-card');
    expect(el.querySelector('.sauce-crm-card__name')?.textContent).toBe('Frank');
    expect(el.querySelector('.sauce-crm-card__subtitle')?.textContent).toBe('Acme Corp');
  });

  it('omits the subtitle row when not provided', () => {
    const el = renderCrmCard(document, { name: 'Solo' });
    expect(el.querySelector('.sauce-crm-card__subtitle')).toBeNull();
  });

  it('zero-literals gate: every inline style value is a var(--token)', () => {
    const el = renderCrmCard(document, { name: 'Frank', subtitle: 'Acme' });
    const all = [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))];
    for (const node of all) {
      for (let i = 0; i < node.style.length; i++) {
        const prop = node.style[i]!; // safe: i < node.style.length
        expect(node.style.getPropertyValue(prop)).toMatch(/^var\(--/);
      }
    }
  });
});
