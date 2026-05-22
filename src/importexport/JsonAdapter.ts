import type { IImportAdapter, IExportAdapter, ImportedEntity } from './IAdapter';

export class JsonImportAdapter implements IImportAdapter {
  readonly id = 'json';
  readonly label = 'JSON';
  async detect(content: string | ArrayBuffer): Promise<boolean> {
    try { JSON.parse(typeof content === 'string' ? content : new TextDecoder().decode(content)); return true; } catch { return false; }
  }
  async parse(content: string | ArrayBuffer): Promise<ImportedEntity[]> {
    const s = typeof content === 'string' ? content : new TextDecoder().decode(content);
    const j = JSON.parse(s) as ImportedEntity[] | { entities: ImportedEntity[] };
    return Array.isArray(j) ? j : j.entities;
  }
}

export class JsonExportAdapter implements IExportAdapter {
  readonly id = 'json';
  readonly label = 'JSON';
  async serialize(entities: ImportedEntity[]): Promise<string> { return JSON.stringify({ entities }, null, 2); }
}
