import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as UserDataBackup from "./userDataBackup.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);

describe("backupUserData", () => {
  it.effect("copies userdata into a folder named for the time and the two versions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-backup-" });
      yield* fileSystem.makeDirectory(path.join(baseDir, "userdata", "logs"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(baseDir, "userdata", "state.sqlite"), "database");

      const folder = Option.getOrThrow(
        yield* UserDataBackup.backupUserData({
          baseDir,
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          now: at("2026-10-30T20:00:00.000Z"),
        }),
      );

      assert.equal(path.basename(folder), "2026-10-30T20-00-00-000Z_1.2.3_to_1.2.4");
      assert.equal(
        yield* fileSystem.readFileString(path.join(folder, "userdata", "state.sqlite")),
        "database",
      );
      assert.isTrue(yield* fileSystem.exists(path.join(folder, "userdata", "logs")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the three newest backups and removes older ones", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-backup-" });
      yield* fileSystem.makeDirectory(path.join(baseDir, "userdata"), { recursive: true });

      for (const day of ["01", "02", "03", "04"]) {
        yield* UserDataBackup.backupUserData({
          baseDir,
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          now: at(`2026-10-${day}T20:00:00.000Z`),
        });
      }

      const kept = yield* fileSystem.readDirectory(path.join(baseDir, "pre-update-backups"));
      assert.deepEqual(kept.toSorted(), [
        "2026-10-02T20-00-00-000Z_1.2.3_to_1.2.4",
        "2026-10-03T20-00-00-000Z_1.2.3_to_1.2.4",
        "2026-10-04T20-00-00-000Z_1.2.3_to_1.2.4",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does nothing when there is no userdata yet", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-backup-" });

      const folder = yield* UserDataBackup.backupUserData({
        baseDir,
        fromVersion: "1.2.3",
        targetVersion: "1.2.4",
        now: at("2026-10-30T20:00:00.000Z"),
      });

      assert.isTrue(Option.isNone(folder));
      assert.isFalse(yield* fileSystem.exists(path.join(baseDir, "pre-update-backups")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fails with a backup error when the copy cannot be written", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-backup-" });
      yield* fileSystem.makeDirectory(path.join(baseDir, "userdata"), { recursive: true });
      // A file where the backups folder should be: the copy cannot be made.
      yield* fileSystem.writeFileString(path.join(baseDir, "pre-update-backups"), "not a folder");

      const failure = yield* UserDataBackup.backupUserData({
        baseDir,
        fromVersion: "1.2.3",
        targetVersion: "1.2.4",
        now: at("2026-10-30T20:00:00.000Z"),
      }).pipe(Effect.flip);

      assert.equal(failure._tag, "UserDataBackupError");
      assert.equal(
        failure.message,
        "Could not copy your data before installing, so the install was cancelled.",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
