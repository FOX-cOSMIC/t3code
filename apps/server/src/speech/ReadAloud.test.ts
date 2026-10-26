import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../processRunner.ts";
import * as ReadAloud from "./ReadAloud.ts";

const pcm = Buffer.from([0, 0, 1, 0, 255, 127, 0, 128]);
const output = {
  stdout: pcm.toString("base64"),
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
};

function provide(run: ProcessRunner.ProcessRunner["Service"]["run"], platform = "win32") {
  return ReadAloud.layer.pipe(
    Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, { run })),
    Layer.provide(Layer.succeed(HostProcess.Platform, platform as NodeJS.Platform)),
  );
}

describe("ReadAloud", () => {
  it.effect.each(["en", "de"] as const)(
    "generates local %s WAV audio without placing text in command arguments",
    (language) =>
      Effect.gen(function* () {
        const service = yield* ReadAloud.ReadAloud;
        const result = yield* service.generate({ text: "**Grüße**; $(never-execute)", language });
        const wav = Buffer.from(result.audioBase64, "base64");
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
        expect(wav.readUInt32LE(24)).toBe(16000);
        expect(wav.subarray(44)).toEqual(pcm);
      }).pipe(
        Effect.provide(
          provide((input) => {
            expect(input.command.toLowerCase()).toContain("powershell");
            expect(input.args.join(" ")).not.toContain("Grüße");
            expect(JSON.parse(input.stdin!)).toEqual({ text: "Grüße; $(never-execute)", language });
            return Effect.succeed(output);
          }),
        ),
      ),
  );

  it.effect("rejects unsupported hosts without launching a process", () =>
    Effect.gen(function* () {
      const service = yield* ReadAloud.ReadAloud;
      expect(
        yield* service.generate({ text: "Hello", language: "en" }).pipe(Effect.flip),
      ).toMatchObject({ reason: "unsupported" });
    }).pipe(Effect.provide(provide(() => Effect.die("must not launch"), "darwin"))),
  );

  it.effect.each(["```\ncode only\n```", "x".repeat(6001)])(
    "rejects empty or oversized spoken text",
    (text) =>
      Effect.gen(function* () {
        const service = yield* ReadAloud.ReadAloud;
        expect(yield* service.generate({ text, language: "en" }).pipe(Effect.flip)).toMatchObject({
          reason: "invalid-text",
        });
      }).pipe(Effect.provide(provide(() => Effect.die("must not launch")))),
  );

  it.effect.each(["", "not base64", "AA=="])(
    "rejects invalid native audio without leaking stderr",
    (stdout) =>
      Effect.gen(function* () {
        const service = yield* ReadAloud.ReadAloud;
        const error = yield* service
          .generate({ text: "private message", language: "en" })
          .pipe(Effect.flip);
        expect(error.reason).toBe("generation-failed");
        expect(error.message).not.toContain("private message");
      }).pipe(
        Effect.provide(
          provide(() => Effect.succeed({ ...output, stdout, stderr: "private message" })),
        ),
      ),
  );

  it.effect(
    "reports a missing installed language voice without falling back to the wrong language",
    () =>
      Effect.gen(function* () {
        const service = yield* ReadAloud.ReadAloud;
        expect(
          yield* service.generate({ text: "Hallo", language: "de" }).pipe(Effect.flip),
        ).toMatchObject({ reason: "voice-unavailable" });
      }).pipe(
        Effect.provide(
          provide(() =>
            Effect.succeed({ ...output, code: ChildProcessSpawner.ExitCode(12), stdout: "" }),
          ),
        ),
      ),
  );
});
