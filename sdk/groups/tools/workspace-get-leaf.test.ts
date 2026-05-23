import { describe, it, expect } from 'vitest';
import { Workspace, WorkspaceLeaf } from 'obsidian';
import { getCrmLeaf } from './workspace-get-leaf';
import { hasApiSymbol } from '../../generated/api-catalog';

describe('tools/workspace-get-leaf', () => {
  it('returns the right-sidebar leaf', () => {
    const leaf = new (WorkspaceLeaf as unknown as { new (): WorkspaceLeaf })();
    const ws = { getRightLeaf: (_split: boolean) => leaf } as unknown as Workspace;
    expect(getCrmLeaf(ws)).toBe(leaf);
  });

  it('propagates a null leaf', () => {
    const ws = { getRightLeaf: () => null } as unknown as Workspace;
    expect(getCrmLeaf(ws)).toBeNull();
  });

  it('catalog-validation gate: Workspace.getRightLeaf exists', () => {
    expect(hasApiSymbol('Workspace.getRightLeaf')).toBe(true);
  });
});
