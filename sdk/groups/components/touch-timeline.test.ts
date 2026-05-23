import { describe, it, expect } from 'vitest';
import { renderTouchTimeline } from './touch-timeline';

const touches = [
  { tick: 1, channel: 'email', summary: 'intro' },
  { tick: 2, channel: 'call' },
];

describe('components/touch-timeline', () => {
  it('renders one row per touch in input order', () => {
    const el = renderTouchTimeline(document, touches);
    const rows = el.querySelectorAll('.sauce-touch-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.sauce-touch-row__channel')?.textContent).toBe('email');
    expect(rows[1].querySelector('.sauce-touch-row__channel')?.textContent).toBe('call');
  });

  it('omits summary span when absent', () => {
    const el = renderTouchTimeline(document, [{ tick: 1, channel: 'sms' }]);
    expect(el.querySelector('.sauce-touch-row__summary')).toBeNull();
  });

  it('zero-literals gate: every inline style value is a var(--token)', () => {
    const el = renderTouchTimeline(document, touches);
    for (const node of [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]) {
      for (let i = 0; i < node.style.length; i++) {
        expect(node.style.getPropertyValue(node.style[i])).toMatch(/^var\(--/);
      }
    }
  });
});
