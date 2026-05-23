// SDK component — source: sdk/groups/components/setting-row.md | api_version: 1.8.0 | gen_hash: hand-cmp002
//
// Headless setting row. Every style value comes from the generated cssTokens map.

import { cssTokens } from '../../generated/css-tokens';

export interface SettingRowModel {
  label: string;
  description?: string;
}

/** Build a setting row element styled only via cssTokens (no literal styles). */
export function renderSettingRow(doc: Document, model: SettingRowModel): HTMLElement {
  const row = doc.createElement('div');
  row.className = 'sauce-setting-row';
  row.style.background = cssTokens.backgroundPrimary;
  row.style.borderColor = cssTokens.backgroundModifierBorder;
  row.style.borderRadius = cssTokens.radiusS;

  const label = doc.createElement('div');
  label.className = 'sauce-setting-row__label';
  label.textContent = model.label;
  label.style.color = cssTokens.textNormal;
  row.appendChild(label);

  if (model.description) {
    const desc = doc.createElement('div');
    desc.className = 'sauce-setting-row__description';
    desc.textContent = model.description;
    desc.style.color = cssTokens.textMuted;
    row.appendChild(desc);
  }

  return row;
}
