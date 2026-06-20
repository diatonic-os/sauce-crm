import { describe, it, expect, vi } from 'vitest';
import { toCheckbox, parseCheckbox, type SauceTask } from '../../src/services/TasksEmitter';
import { TasksAdapter, SAUCE_TASKS_PROFILE, TASKS_PLUGIN_ID } from '../../src/integrations/obsidian/TasksAdapter';
import { PluginConfigService, type PluginConfigHost, type PluginKind } from '../../src/services/PluginConfigService';

function memHost(initial: Record<string, unknown> | null): PluginConfigHost {
  let data = initial;
  return {
    isInstalled: (_id: string, _k: PluginKind) => data !== null,
    readConfig: async () => (data ? { ...data } : null),
    writeConfig: async (_id: string, _k: PluginKind, d: Record<string, unknown>) => { data = { ...d }; },
    backupConfig: async () => {},
  };
}

function runtime() {
  return { isEnabled: () => true, getVersion: () => '7.0.0', getApiV1: () => null };
}

describe('TasksEmitter round-trip idempotence', () => {
  const cases: SauceTask[] = [
    { title: 'Buy milk', status: 'todo' },
    { title: 'Call Alice', status: 'done', due: '2024-05-01', priority: 'high', contact: 'Alice' },
    { title: 'Write tests', status: 'in_progress', priority: 'urgent', tags: ['dev', 'quality'] },
  ];

  for (const task of cases) {
    it(`round-trips: "${task.title}"`, () => {
      const line = toCheckbox(task);
      const parsed = parseCheckbox(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.title).toBe(task.title);
      expect(parsed!.status).toBe(task.status);
      if (task.due) expect(parsed!.due).toBe(task.due);
      if (task.priority) expect(parsed!.priority).toBe(task.priority);
      if (task.contact) expect(parsed!.contact).toBe(task.contact);
    });
  }

  it('toCheckbox→parseCheckbox→toCheckbox is stable (idempotent)', () => {
    const task: SauceTask = { title: 'Test task', status: 'todo', due: '2024-06-01', priority: 'medium' };
    const line1 = toCheckbox(task);
    const parsed = parseCheckbox(line1)!;
    const line2 = toCheckbox(parsed);
    expect(line2).toBe(line1);
  });
});

describe('TasksAdapter.syncResource with tasksService', () => {
  it('returns pulled count equal to tasks found', async () => {
    const mockTasksService = {
      listTasks: vi.fn().mockResolvedValue([
        { task: { title: 'Task A', status: 'todo' as const }, path: '_TASKS.md', line: 1 },
        { task: { title: 'Task B', status: 'done' as const }, path: '_TASKS.md', line: 2 },
      ]),
      addTask: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new TasksAdapter(
      new PluginConfigService(memHost({}), [SAUCE_TASKS_PROFILE]),
      runtime(),
      SAUCE_TASKS_PROFILE,
      mockTasksService,
    );
    const result = await adapter.syncResource();
    expect(result.pulled).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('returns zeros when tasksService is absent', async () => {
    const adapter = new TasksAdapter(
      new PluginConfigService(memHost({}), [SAUCE_TASKS_PROFILE]),
      runtime(),
    );
    const result = await adapter.syncResource();
    expect(result.pulled).toBe(0);
    expect(result.pushed).toBe(0);
    expect(result.errors).toBe(0);
  });
});
