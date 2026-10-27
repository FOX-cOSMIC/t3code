import { describe, expect, it } from "@effect/vitest";
import { ReadAloudError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ReadAloud from "./ReadAloud.ts";

type Synthesize = ReadAloud.ReadAloudEngine["Service"]["synthesize"];

function provide(synthesize: Synthesize, platform = "win32") {
  return ReadAloud.layer.pipe(
    Layer.provide(Layer.succeed(ReadAloud.ReadAloudEngine, { synthesize, install: Effect.void })),
    Layer.provide(Layer.succeed(HostProcess.Platform, platform as NodeJS.Platform)),
  );
}

const speech = { samples: new Float32Array([0, 0.5, -0.5, 1]), sampleRate: 24000 };

describe("ReadAloud", () => {
  it.effect("detects the language from the text and returns WAV audio", () => {
    const voices: string[] = [];
    return Effect.gen(function* () {
      const service = yield* ReadAloud.ReadAloud;
      const result = yield* service.generate({
        text: "**Das ist** ein Test, der die Stimme nutzt.",
      });
      const wav = Buffer.from(result.audioBase64, "base64");
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.readUInt32LE(24)).toBe(24000);
      expect(wav.length).toBe(44 + 8);
      yield* service.generate({ text: "This is a test of the voice that you can use." });
      expect(voices).toEqual(["de", "en"]);
    }).pipe(
      Effect.provide(
        provide((voice, text) => {
          voices.push(voice);
          expect(text).not.toContain("**");
          return Effect.succeed(speech);
        }),
      ),
    );
  });

  it.effect("lets an explicit language override detection", () => {
    const voices: string[] = [];
    return Effect.gen(function* () {
      const service = yield* ReadAloud.ReadAloud;
      yield* service.generate({ text: "Das ist ein Test.", language: "en" });
      expect(voices).toEqual(["en"]);
    }).pipe(
      Effect.provide(
        provide((voice) => {
          voices.push(voice);
          return Effect.succeed(speech);
        }),
      ),
    );
  });

  it.effect("rejects unsupported hosts without using the engine", () =>
    Effect.gen(function* () {
      const service = yield* ReadAloud.ReadAloud;
      expect(yield* service.generate({ text: "Hello" }).pipe(Effect.flip)).toMatchObject({
        reason: "unsupported",
      });
    }).pipe(Effect.provide(provide(() => Effect.die("must not run"), "darwin"))),
  );

  it.effect.each(["```\ncode only\n```", "x".repeat(4001)])(
    "rejects empty or oversized spoken text",
    (text) =>
      Effect.gen(function* () {
        const service = yield* ReadAloud.ReadAloud;
        expect(yield* service.generate({ text }).pipe(Effect.flip)).toMatchObject({
          reason: "invalid-text",
        });
      }).pipe(Effect.provide(provide(() => Effect.die("must not run")))),
  );

  it.effect("passes engine errors such as voices still downloading through", () =>
    Effect.gen(function* () {
      const service = yield* ReadAloud.ReadAloud;
      expect(yield* service.generate({ text: "Hello" }).pipe(Effect.flip)).toMatchObject({
        reason: "voice-unavailable",
        message: "Downloading (12%).",
      });
    }).pipe(
      Effect.provide(
        provide(() =>
          Effect.fail(
            new ReadAloudError({ reason: "voice-unavailable", message: "Downloading (12%)." }),
          ),
        ),
      ),
    ),
  );

  it.effect.each([
    { samples: new Float32Array(0), sampleRate: 24000 },
    { samples: new Float32Array(4), sampleRate: 0 },
    { samples: new Float32Array(9 * 1024 * 1024), sampleRate: 24000 },
  ])("rejects invalid engine audio without leaking the text", (audio) =>
    Effect.gen(function* () {
      const service = yield* ReadAloud.ReadAloud;
      const error = yield* service.generate({ text: "private message" }).pipe(Effect.flip);
      expect(error.reason).toBe("generation-failed");
      expect(error.message).not.toContain("private message");
    }).pipe(Effect.provide(provide(() => Effect.succeed(audio)))),
  );
});
