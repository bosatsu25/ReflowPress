/**
 * Migration Framework & Future Schema Safety for ReflowPress.
 */

export class UpgradeRequiredError extends Error {
  readonly currentVersion: number;
  readonly incomingVersion: number;
  readonly entityName: string;

  constructor(
    entityName: string,
    currentVersion: number,
    incomingVersion: number,
  ) {
    super(
      `Unsupported ${entityName} schema version ${incomingVersion} (highest supported by this version of ReflowPress is ${currentVersion}). Please upgrade ReflowPress to access this data safely without risk of data loss.`,
    );
    this.name = "UpgradeRequiredError";
    this.entityName = entityName;
    this.currentVersion = currentVersion;
    this.incomingVersion = incomingVersion;
  }
}

export class CorruptDataError extends Error {
  readonly entityName: string;
  readonly causeError?: unknown;

  constructor(entityName: string, message: string, causeError?: unknown) {
    super(`Corrupt ${entityName} data detected: ${message}`);
    this.name = "CorruptDataError";
    this.entityName = entityName;
    this.causeError = causeError;
  }
}

export interface Migration<T = unknown> {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(data: unknown): T;
}

export interface MigrationRunnerOptions<T> {
  readonly entityName: string;
  readonly currentVersion: number;
  readonly migrations?: readonly Migration<unknown>[];
  readonly validate: (data: unknown) => data is T;
}

export class MigrationRunner<T> {
  private readonly entityName: string;
  private readonly currentVersion: number;
  private readonly migrations: readonly Migration<unknown>[];
  private readonly validate: (data: unknown) => data is T;

  constructor(options: MigrationRunnerOptions<T>) {
    this.entityName = options.entityName;
    this.currentVersion = options.currentVersion;
    this.migrations = options.migrations ?? [];
    this.validate = options.validate;
  }

  run(raw: unknown): T {
    if (typeof raw !== "object" || raw === null) {
      throw new CorruptDataError(this.entityName, "Expected an object");
    }

    const rawObj = raw as Record<string, unknown>;
    const versionVal = rawObj.schemaVersion ?? rawObj.version;
    const numericVersion = typeof versionVal === "number" ? versionVal : 1;

    if (numericVersion > this.currentVersion) {
      throw new UpgradeRequiredError(
        this.entityName,
        this.currentVersion,
        numericVersion,
      );
    }

    let currentData: unknown = raw;
    let v = numericVersion;

    while (v < this.currentVersion) {
      const migration = this.migrations.find((m) => m.fromVersion === v);
      if (!migration) {
        throw new CorruptDataError(
          this.entityName,
          `No migration path available from schema version ${v} to ${v + 1}`,
        );
      }
      currentData = migration.migrate(currentData);
      v = migration.toVersion;
    }

    if (!this.validate(currentData)) {
      throw new CorruptDataError(
        this.entityName,
        "Data failed schema validation after migration",
      );
    }

    return currentData;
  }
}
