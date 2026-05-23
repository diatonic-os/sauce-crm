// SDK component — source: sdk/groups/components/inbox-view.md | api_version: 1.8.0 | gen_hash: hand-cmp004
//
// Headless AI-inbox list. Every style value comes from the generated cssTokens map.

import { cssTokens } from '../../generated/css-tokens';

export interface InboxItem {
  title: string;
  subtitle?: string;
}

/** Build an inbox list element styled only via cssTokens (no literal styles). */
export function renderInbox(doc: Document, items: readonly InboxItem[]): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'sauce-inbox';
  root.style.background = cssTokens.backgroundPrimary;

  if (items.length === 0) {
    const empty = doc.createElement('div');
    empty.className = 'sauce-inbox__empty';
    empty.textContent = 'Inbox zero';
    empty.style.color = cssTokens.textFaint;
    root.appendChild(empty);
    return root;
  }

  for (const item of items) {
    const row = doc.createElement('div');
    row.className = 'sauce-inbox__item';
    row.style.borderColor = cssTokens.backgroundModifierBorder;
    row.style.borderRadius = cssTokens.radiusS;

    const title = doc.createElement('div');
    title.className = 'sauce-inbox__title';
    title.textContent = item.title;
    title.style.color = cssTokens.textNormal;
    row.appendChild(title);

    if (item.subtitle) {
      const sub = doc.createElement('div');
      sub.className = 'sauce-inbox__subtitle';
      sub.textContent = item.subtitle;
      sub.style.color = cssTokens.textMuted;
      row.appendChild(sub);
    }
    root.appendChild(row);
  }

  return root;
}
