import { describe, it, expect } from 'vitest';
import { parseCssVars } from './parse-css-vars';

const DOC = `---
cssclasses: reference
---
## CSS variables

### Properties container

| Variable                     | Description             |
| ---------------------------- | ----------------------- |
| \`--metadata-background\`      | Background color        |
| \`--metadata-padding\`         | Padding                 |

### Individual properties

| Variable                   | Description     |
| -------------------------- | --------------- |
| \`--metadata-divider-color\` | Divider color   |
`;

describe('generator/parse-css-vars', () => {
  it('extracts tokens with description and section', () => {
    const toks = parseCssVars(DOC);
    expect(toks).toEqual([
      { token: '--metadata-background', description: 'Background color', section: 'Properties container' },
      { token: '--metadata-divider-color', description: 'Divider color', section: 'Individual properties' },
      { token: '--metadata-padding', description: 'Padding', section: 'Properties container' },
    ]);
  });

  it('sorts by token ascending', () => {
    const toks = parseCssVars(DOC);
    expect(toks.map((t) => t.token)).toEqual([...toks.map((t) => t.token)].sort());
  });

  it('dedupes by token (first wins)', () => {
    const dup = '### S\n| V | D |\n| --- | --- |\n| `--x` | first |\n| `--x` | second |\n';
    expect(parseCssVars(dup)).toEqual([{ token: '--x', description: 'first', section: 'S' }]);
  });

  it('returns empty for docs with no variable rows', () => {
    expect(parseCssVars('# Page\n\nNothing here.')).toEqual([]);
  });
});
