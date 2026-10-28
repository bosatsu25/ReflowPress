# Persistence Migration Framework & Future Schema Safety

This document describes the persistence migration architecture and forward-compatibility safeguards implemented in ReflowPress.

---

## 1. Design Goals

1. **User Data Safety First**: Never corrupt, truncate, or overwrite user files when encountering schemas newer than the running application version.
2. **Deterministic Step-by-Step Migrations**: Support forward migration paths between consecutive schema versions (\(v \to v+1\)) with strict validation at each transition.
3. **Transparent Error Boundaries**: Distinguish clearly between **syntax corruption** (unparseable JSON / disk truncation) which requires isolation/quarantine, and **unsupported future schemas** which MUST be preserved intact while prompting the user to upgrade.

---

## 2. Core Primitives (`@reflowpress/core`)

### `UpgradeRequiredError`

Thrown when encountering data with `schemaVersion > CURRENT_SCHEMA_VERSION`.

- Signals that the stored entity was created by a newer version of ReflowPress.
- Repositories (`JsonLibraryRepository`, `JsonAnnotationRepository`, `ReadingPositionStore`, `SyncBundle`) catch or surface this error without touching, overwriting, or quarantining the file.
- The user is notified to upgrade ReflowPress.

### `CorruptDataError`

Thrown when data fails structural validation or an essential intermediate migration step is missing.

### `Migration<T>`

```typescript
export interface Migration<T = unknown> {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(data: unknown): T;
}
```

### `MigrationRunner<T>`

Orchestrates sequential migration execution:

1. Validates that the input is a valid object.
2. Reads `schemaVersion` (or `version`).
3. Rejects future versions immediately with `UpgradeRequiredError`.
4. Loops incrementally through registered `Migration` steps until `currentVersion` is reached.
5. Runs post-migration schema validation.

---

## 3. Storage Adapters

| Storage Entity       | File Location                  | Schema Version | Quarantine on Corrupt  | Future Version Behavior                          |
| :------------------- | :----------------------------- | :------------- | :--------------------- | :----------------------------------------------- |
| **Library Catalog**  | `userData/library-v1.json`     | 1              | Yes (`.corrupt-*`)     | Throws `UpgradeRequiredError`, keeps file intact |
| **Annotation Store** | `userData/annotations-v1.json` | 1              | Yes (`.corrupt-*`)     | Throws `UpgradeRequiredError`, keeps file intact |
| **Reading State**    | `userData/reader-state.json`   | 1              | Graceful reset         | Throws `UpgradeRequiredError`, keeps file intact |
| **Sync Bundle**      | `bundle.zip` / `manifest.json` | 1              | N/A (read-only bundle) | Throws `UpgradeRequiredError`, refuses import    |

---

## 4. Verification

Persistence migration and schema safety are covered by automated unit tests in `tests/unit/migration.test.ts`:

- Sequential multi-step migration paths.
- Future schema version rejection without file corruption or quarantine.
- Syntax corruption quarantine behavior.
