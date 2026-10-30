import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

/** Dated copies kept under <T3 home>/pre-update-backups; older ones are removed. */
const KEPT_INSTALL_BACKUPS = 3;

export class UserDataBackupError extends Schema.TaggedError<UserDataBackupError>()(
  "UserDataBackupError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not copy your data before installing, so the install was cancelled.";
  }
}

export interface BackupUserDataInput {
  readonly baseDir: string;
  readonly fromVersion: string;
  readonly targetVersion: string;
  readonly now: DateTime.Utc;
}

// Versions become part of a folder name, so anything but plain name characters becomes "-".
const folderPart = (version: string) => version.replace(/[^A-Za-z0-9._-]/g, "-");

/**
 * Copies <baseDir>/userdata into a new folder under <baseDir>/pre-update-backups, named for the
 * time and the two versions, and returns that folder. Returns none when there is no data yet.
 * The caller stops the backends first, so the database is closed and the copy is consistent.
 */
export const backupUserData = Effect.fn("desktop.updates.backupUserData")(
  function* (input: BackupUserDataInput) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const source = path.join(input.baseDir, "userdata");
    if (!(yield* fileSystem.exists(source))) return Option.none<string>();

    const backupsDir = path.join(input.baseDir, "pre-update-backups");
    const stamp = DateTime.formatIso(input.now).replace(/[:.]/g, "-");
    const folder = path.join(
      backupsDir,
      `${stamp}_${folderPart(input.fromVersion)}_to_${folderPart(input.targetVersion)}`,
    );
    yield* fileSystem.makeDirectory(folder, { recursive: true });
    yield* fileSystem.copy(source, path.join(folder, "userdata"), { preserveTimestamps: true });

    // Names start with the time, so sorting them puts the oldest first. A failed cleanup keeps the new copy.
    const names = (yield* fileSystem.readDirectory(backupsDir)).toSorted();
    const stale = names.slice(0, Math.max(0, names.length - KEPT_INSTALL_BACKUPS));
    yield* Effect.forEach(
      stale,
      (name) => fileSystem.remove(path.join(backupsDir, name), { recursive: true, force: true }),
      { discard: true },
    ).pipe(Effect.ignore);

    return Option.some(folder);
  },
  Effect.mapError((cause) => new UserDataBackupError({ cause })),
);

export class UserDataBackup extends Context.Service<
  UserDataBackup,
  {
    /** Copies the data before an install to `targetVersion`. A failed copy cancels that install. */
    readonly backupBeforeInstall: (
      targetVersion: string,
    ) => Effect.Effect<Option.Option<string>, UserDataBackupError>;
  }
>()("@t3tools/desktop/updates/userDataBackup") {}

export const layer = Layer.effect(
  UserDataBackup,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return UserDataBackup.of({
      backupBeforeInstall: Effect.fn("desktop.updates.backupBeforeInstall")(
        function* (targetVersion) {
          const now = yield* DateTime.now;
          return yield* backupUserData({
            baseDir: environment.baseDir,
            fromVersion: environment.appVersion,
            targetVersion,
            now,
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          );
        },
      ),
    });
  }),
);
