import { ReadAloudError, ReadAloudInput, type ReadAloudAudio } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { detectReadAloudLanguage, readAloudText } from "@t3tools/shared/readAloud";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { wavFromSamples, type ReadAloudVoiceId } from "./readAloudVoices.ts";

/** About six minutes of speech at 24 kHz; keeps one reply well inside RPC payload limits. */
const maximumAudioBytes = 16 * 1024 * 1024;
const maximumTextLength = 4000;
const decodeInput = Schema.decodeUnknownEffect(ReadAloudInput);

export class ReadAloudEngine extends Context.Service<
  ReadAloudEngine,
  {
    /** Turns text into speech with one installed local voice. Installs voices on first use. */
    readonly synthesize: (
      voice: ReadAloudVoiceId,
      text: string,
    ) => Effect.Effect<{ samples: Float32Array; sampleRate: number }, ReadAloudError>;
    /** Downloads and unpacks the voices if they are missing, and completes when they are ready. */
    readonly install: Effect.Effect<void, ReadAloudError>;
  }
>()("t3/speech/ReadAloud/ReadAloudEngine") {}

export class ReadAloud extends Context.Service<
  ReadAloud,
  {
    readonly generate: (input: ReadAloudInput) => Effect.Effect<ReadAloudAudio, ReadAloudError>;
  }
>()("t3/speech/ReadAloud") {}

const make = Effect.gen(function* () {
  const engine = yield* ReadAloudEngine;
  const platform = yield* HostProcess.Platform;
  const synthesis = yield* Semaphore.make(1);
  const generate = Effect.fn("ReadAloud.generate")(function* (input: ReadAloudInput) {
    if (platform !== "win32")
      return yield* new ReadAloudError({
        reason: "unsupported",
        message: "Read aloud currently requires a Windows environment.",
      });
    const validated = yield* decodeInput(input).pipe(
      Effect.mapError(
        () =>
          new ReadAloudError({
            reason: "invalid-text",
            message: "Read aloud needs a message under 20,000 characters.",
          }),
      ),
    );
    const text = readAloudText(validated.text);
    if (text.length === 0 || text.length > maximumTextLength)
      return yield* new ReadAloudError({
        reason: "invalid-text",
        message: `Read aloud needs between 1 and ${maximumTextLength.toLocaleString("en-US")} characters of prose. Code blocks, images and tables are skipped.`,
      });
    const voice = validated.language ?? detectReadAloudLanguage(text);
    const audio = yield* engine.synthesize(voice, text);
    if (
      audio.samples.length === 0 ||
      !Number.isInteger(audio.sampleRate) ||
      audio.sampleRate <= 0 ||
      audio.samples.length * 2 > maximumAudioBytes
    ) {
      return yield* new ReadAloudError({
        reason: "generation-failed",
        message: "The local speech engine could not generate valid audio. Try a shorter reply.",
      });
    }
    return {
      audioBase64: wavFromSamples(audio.samples, audio.sampleRate).toString("base64"),
      mimeType: "audio/wav" as const,
    };
  }, synthesis.withPermit);
  return ReadAloud.of({ generate });
});

export const layer = Layer.effect(ReadAloud, make);
