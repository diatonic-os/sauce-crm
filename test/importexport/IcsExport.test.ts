import { describe, it, expect } from 'vitest';
import { IcsExportAdapter } from '../../src/importexport/IcsAdapter';

describe('IcsExportAdapter — multi-type VEVENT emission', () => {
  const adapter = new IcsExportAdapter();

  it('emits VCALENDAR wrapper', async () => {
    const out = await adapter.serialize([]);
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).toContain('END:VCALENDAR');
  });

  it('emits VEVENT for type:touch (existing behavior)', async () => {
    const out = await adapter.serialize([{
      type: 'touch',
      frontmatter: { id: 'uid-1', summary: 'Met Alice', date: '2024-05-01' },
    }]);
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('SUMMARY:Met Alice');
    expect(out).toContain('DTSTART:2024-05-01');
  });

  it('emits VEVENT for type:task with SUMMARY and DTSTART from due', async () => {
    const out = await adapter.serialize([{
      type: 'task',
      frontmatter: { id: 'uid-task-1', title: 'Write report', due: '2024-06-15' },
    }]);
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('SUMMARY:Write report');
    expect(out).toContain('DTSTART:2024-06-15');
    expect(out).toContain('UID:uid-task-1');
  });

  it('emits VEVENT for type:followup using due date', async () => {
    const out = await adapter.serialize([{
      type: 'followup',
      frontmatter: { id: 'uid-fu-1', title: 'Follow up with Bob', due: '2024-06-20' },
    }]);
    expect(out).toContain('SUMMARY:Follow up with Bob');
    expect(out).toContain('DTSTART:2024-06-20');
  });

  it('emits VEVENT for type:event using date field', async () => {
    const out = await adapter.serialize([{
      type: 'event',
      frontmatter: { id: 'uid-ev-1', title: 'Team offsite', date: '2024-07-10' },
    }]);
    expect(out).toContain('SUMMARY:Team offsite');
    expect(out).toContain('DTSTART:2024-07-10');
  });

  it('handles mixed entity types in one export', async () => {
    const out = await adapter.serialize([
      { type: 'touch', frontmatter: { summary: 'Touch 1', date: '2024-01-01' } },
      { type: 'task', frontmatter: { title: 'Task 1', due: '2024-01-02' } },
      { type: 'event', frontmatter: { title: 'Event 1', date: '2024-01-03' } },
    ]);
    const count = (out.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(count).toBe(3);
  });
});
