// SDK component — source: sdk/groups/components/touch-timeline.md | api_version: 1.8.0 | gen_hash: hand-cmp003
//
// Headless touch timeline. Every style value comes from the generated cssTokens map.

import { cssTokens } from '../../generated/css-tokens';

export interface TouchRow {
  tick: number;
  channel: string;
  summary?: string;
}

/** Build a touch-timeline element styled only via cssTokens (no literal styles). */
export function renderTouchTimeline(doc: Document, touches: readonly TouchRow[]): HTMLElement {
  const list = doc.createElement('div');
  list.className = 'sauce-touch-timeline';
  list.style.background = cssTokens.backgroundSecondary;
  list.style.borderRadius = cssTokens.radiusM;

  for (const t of touches) {
    const row = doc.createElement('div');
    row.className = 'sauce-touch-row';
    row.style.color = cssTokens.textNormal;
    row.style.borderColor = cssTokens.backgroundModifierBorder;

    const channel = doc.createElement('span');
    channel.className = 'sauce-touch-row__channel';
    channel.textContent = t.channel;
    channel.style.color = cssTokens.textAccent;
    row.appendChild(channel);

    if (t.summary) {
      const summary = doc.createElement('span');
      summary.className = 'sauce-touch-row__summary';
      summary.textContent = t.summary;
      summary.style.color = cssTokens.textMuted;
      row.appendChild(summary);
    }
    list.appendChild(row);
  }

  return list;
}
