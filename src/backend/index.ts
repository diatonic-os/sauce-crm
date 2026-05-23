// Backend barrel. The plugin uses a single persistence engine: LanceDB.
// The former SQLite backends (better-sqlite3 / sql.js / file-only) and the
// SqliteSync/Seeder/Migrations mirror were removed in the LanceDB migration —
// see PLAN-LANCEDB-MIGRATION.md.

export * from "./lance";
