import { ReadAloudError, ReadAloudInput, type ReadAloudAudio } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { readAloudText } from "@t3tools/shared/readAloud";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ProcessRunner from "../processRunner.ts";

const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$stream = New-Object System.IO.MemoryStream
try {
  $voice = $synth.GetInstalledVoices() | Where-Object {
    $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $payload.language
  } | Select-Object -First 1
  if ($null -eq $voice) { exit 12 }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )
  $synth.SetOutputToAudioStream($stream, $format)
  $synth.Speak([string]$payload.text)
  [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))
} finally {
  $synth.Dispose()
  $stream.Dispose()
}
`;
const encodedScript = Buffer.from(script, "utf16le").toString("base64");
const maximumAudioBytes = 16 * 1024 * 1024;
const decodeInput = Schema.decodeUnknownEffect(ReadAloudInput);
const encodeInput = Schema.encodeSync(Schema.fromJsonString(ReadAloudInput));

export class ReadAloud extends Context.Service<
  ReadAloud,
  {
    readonly generate: (input: ReadAloudInput) => Effect.Effect<ReadAloudAudio, ReadAloudError>;
  }
>()("t3/speech/ReadAloud") {}

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const synthesis = yield* Semaphore.make(1);
  const generate = Effect.fn("ReadAloud.generate")(function* (input: ReadAloudInput) {
    if (platform !== "win32")
      return yield* new ReadAloudError({
        reason: "unsupported",
        message: "Read aloud currently requires a Windows environment with local speech voices.",
      });
    const validated = yield* decodeInput(input).pipe(
      Effect.mapError(
        () =>
          new ReadAloudError({
            reason: "invalid-text",
            message: "Choose English or German and a message under 20,000 characters.",
          }),
      ),
    );
    const text = readAloudText(validated.text);
    if (text.length === 0 || text.length > 6000)
      return yield* new ReadAloudError({
        reason: "invalid-text",
        message:
          "Read aloud needs between 1 and 6,000 characters of prose. Code blocks, images and tables are skipped.",
      });
    const result = yield* runner
      .run({
        command: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-EncodedCommand",
          encodedScript,
        ],
        stdin: encodeInput({ text, language: validated.language }),
        timeout: "2 minutes",
        maxOutputBytes: 24 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError(
          () =>
            new ReadAloudError({
              reason: "generation-failed",
              message: "Local speech generation failed or timed out. Try a shorter reply.",
            }),
        ),
      );
    if (result.code === 12)
      return yield* new ReadAloudError({
        reason: "voice-unavailable",
        message: `Install a Windows desktop speech voice for ${validated.language === "de" ? "German" : "English"} to read this message aloud.`,
      });
    const base64 = result.stdout.trim();
    const pcm = Buffer.from(base64, "base64");
    if (
      result.code !== 0 ||
      result.timedOut ||
      pcm.length === 0 ||
      pcm.length % 2 !== 0 ||
      pcm.length > maximumAudioBytes ||
      pcm.toString("base64") !== base64
    ) {
      return yield* new ReadAloudError({
        reason: "generation-failed",
        message: "The local speech engine could not generate valid audio.",
      });
    }
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);
    return { audioBase64: wav.toString("base64"), mimeType: "audio/wav" as const };
  }, synthesis.withPermit);
  return ReadAloud.of({ generate });
});

export const layer = Layer.effect(ReadAloud, make);
