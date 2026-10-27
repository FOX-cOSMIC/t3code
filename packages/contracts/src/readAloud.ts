import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ReadAloudLanguage = Schema.Literals(["en", "de"]);
export type ReadAloudLanguage = typeof ReadAloudLanguage.Type;

export const ReadAloudInput = Schema.Struct({
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  /** Omit to let the environment detect English or German from the text. */
  language: Schema.optionalKey(ReadAloudLanguage),
});
export type ReadAloudInput = typeof ReadAloudInput.Type;

export const ReadAloudAudio = Schema.Struct({
  audioBase64: Schema.String,
  mimeType: Schema.Literal("audio/wav"),
});
export type ReadAloudAudio = typeof ReadAloudAudio.Type;

export class ReadAloudError extends Schema.TaggedError<ReadAloudError>()("ReadAloudError", {
  reason: Schema.Literals([
    "unsupported",
    "voice-unavailable",
    "invalid-text",
    "generation-failed",
  ]),
  message: Schema.String,
}) {}
