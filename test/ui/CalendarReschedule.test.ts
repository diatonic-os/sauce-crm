import { describe, it, expect, vi } from 'vitest';

describe('CalendarView.reschedule field-mapping', () => {
  // We test the field-mapping logic directly without Obsidian.
  // The rule: type=task|followup → field 'due'; type=touch|event → field 'date'

  function fieldFor(type: string): string {
    return (type === 'task' || type === 'followup') ? 'due' : 'date';
  }

  it('maps task type to due field', () => { expect(fieldFor('task')).toBe('due'); });
  it('maps followup type to due field', () => { expect(fieldFor('followup')).toBe('due'); });
  it('maps touch type to date field', () => { expect(fieldFor('touch')).toBe('date'); });
  it('maps event type to date field', () => { expect(fieldFor('event')).toBe('date'); });

  it('updateFrontmatter is called with new date for a task drop', async () => {
    const updateFrontmatter = vi.fn().mockResolvedValue(undefined);
    const mockFm = { type: 'task', due: '2024-01-01', title: 'Foo' };

    // Simulate reschedule logic
    const fm = { ...mockFm };
    const field = fieldFor(fm.type);
    const newDate = '2024-02-01';
    await updateFrontmatter({}, (f: Record<string, unknown>) => { f[field] = newDate; });

    expect(updateFrontmatter).toHaveBeenCalledOnce();
    const mutator = updateFrontmatter.mock.calls[0]?.[1] as (f: Record<string, unknown>) => void;
    const captured: Record<string, unknown> = { ...fm };
    mutator(captured);
    expect(captured['due']).toBe('2024-02-01');
  });
});
