import type Database from "better-sqlite3";
/** True when migration files are present (production/committed migrations). */
export declare const hasMigrationsDir: () => boolean;
/** Push the Prisma schema directly to the database — for dev/CI where migration files are not committed. */
export declare const pushSchemaViaPrisma: (dbPath: string) => void;
/** Apply all pending Prisma migrations to the database. No-op when no migrations dir exists (schema already pushed via prisma db push). */
export declare const applyMigrations: (db: Database.Database) => void;
//# sourceMappingURL=migrate.d.ts.map