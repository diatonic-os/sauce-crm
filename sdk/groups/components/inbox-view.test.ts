import { describe, it, expect } from 'vitest';
import { renderInbox } from './inbox-view';

describe('components/inbox-view', () => {
  it('renders one item row per item', () => {
    const el = renderInbox(document, [{ title: 'Reply to Frank', subtitle: 'overdue' }, { title: 'Schedule Acme' }]);
    expect(el.querySelectorAll('.sauce-inbox__item').length).toBe(2);
    expect(el.querySelector('.sauce-inbox__title')?.textContent).toBe('Reply to Frank');
  });

  it('shows an empty state when there are no items', () => {
    const el = renderInbox(document, []);
    expect(el.querySelector('.sauce-inbox__empty')?.textContent).toBe('Inbox zero');
    expect(el.querySelector('.sauce-inbox__item')).toBeNull();
  });

  it('zero-literals gate: every inline style value is a var(--token)', () => {
    const el = renderInbox(document, [{ title: 'X', subtitle: 'Y' }]);
    for (const node of [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]) {
      for (let i = 0; i < node.style.length; i++) {
        expect(node.style.getPropertyValue(node.style[i])).toMatch(/^var\(--/);
      }
    }
  });
});
