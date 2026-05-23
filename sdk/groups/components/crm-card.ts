// SDK component — source: sdk/groups/components/crm-card.md | api_version: 1.8.0 | gen_hash: hand-cmp001
//
// Headless CRM card. Every style value comes from the generated cssTokens map.

import { cssTokens } from '../../generated/css-tokens';

export interface CrmCardModel {
  name: string;
  subtitle?: string;
}

/** Build a CRM card element styled only via cssTokens (no literal styles). */
export function renderCrmCard(doc: Document, model: CrmCardModel): HTMLElement {
  const card = doc.createElement('div');
  card.className = 'sauce-crm-card';
  card.style.background = cssTokens.backgroundSecondary;
  card.style.color = cssTokens.textNormal;
  card.style.borderRadius = cssTokens.radiusM;

  const name = doc.createElement('div');
  name.className = 'sauce-crm-card__name';
  name.textContent = model.name;
  name.style.color = cssTokens.textNormal;
  card.appendChild(name);

  if (model.subtitle) {
    const sub = doc.createElement('div');
    sub.className = 'sauce-crm-card__subtitle';
    sub.textContent = model.subtitle;
    sub.style.color = cssTokens.textMuted;
    card.appendChild(sub);
  }

  return card;
}
