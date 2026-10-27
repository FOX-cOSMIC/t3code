import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import { ReadAloudError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ServerConfig from "../config.ts";
import * as DictationArtifacts from "../dictation/DictationArtifacts.ts";
import { createIntegrityHash } from "../dictation/integrity.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ReadAloudEngine } from "./ReadAloud.ts";
import {
  englishSpeakerId,
  germanFiles,
  germanModelMetadata,
  kokoroArchive,
  piperTokens,
  totalDownloadBytes,
  type ReadAloudVoiceId,
} from "./readAloudVoices.ts";

interface NativeTtsAddon {
  createOfflineTtsAsync: (config: unknown) => Promise<unknown>;
  offlineTtsGenerateAsync: (
    handle: unknown,
    request: { text: string; sid: number; speed: number },
  ) => Promise<{ samples: Float32Array; sampleRate: number }>;
}

const generationTimeout = "3 minutes";
const decodePiperConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      audio: Schema.Struct({ sample_rate: Schema.Number }),
      num_speakers: Schema.optionalKey(Schema.Number),
      phoneme_id_map: Schema.Record(Schema.String, Schema.Array(Schema.Number)),
    }),
  ),
);

/**
 * sherpa-onnx text-to-speech on the native runtime that dictation already installs.
 * Voices (about 430 MB) download in the background the first time read aloud is used.
 */
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const config = yield* ServerConfig.ServerConfig;
  const runner = yield* ProcessRunner.ProcessRunner;
  const artifacts = yield* DictationArtifacts.DictationArtifacts;
  const platform = yield* HostProcess.Platform;
  const scope = yield* Effect.scope;
  const root = path.join(config.stateDir, "read-aloud", "voices-v1");
  const kokoroDirectory = path.join(root, kokoroArchive.directory);
  const germanDirectory = path.join(root, "de");
  const installing = yield* Semaphore.make(1);
  const handles = new Map<ReadAloudVoiceId, unknown>();
  let addon: NativeTtsAddon | null = null;
  let downloaded = 0;
  let installFailed: string | null = null;
  let installRunning = false;

  const failure = (reason: ReadAloudError["reason"], message: string) =>
    new ReadAloudError({ reason, message });
  const io = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
    operation.pipe(
      Effect.tapError((cause) => Effect.logWarning("read-aloud file operation failed", { cause })),
      Effect.mapError(() => failure("generation-failed", "Could not access read-aloud voices.")),
    );

  const installed = fs
    .exists(path.join(root, "installed.json"))
    .pipe(Effect.orElseSucceed(() => false));

  // Downloads stream to a temporary file; the finalizer of the install scope removes partial files.
  const download = Effect.fnUntraced(function* (
    file: { url: string; bytes: number; sha256: string },
    destination: string,
  ) {
    const unavailable = () => failure("generation-failed", "Could not download the voices.");
    const response = yield* http
      .get(file.url)
      .pipe(
        Effect.mapError(unavailable),
        Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.fail(unavailable()) }),
      );
    if (response.status !== 200) return yield* unavailable();
    const target = yield* io(fs.open(destination, { flag: "wx" }));
    const hash = createIntegrityHash("sha256");
    let received = 0;
    yield* response.stream.pipe(
      Stream.timeout("60 seconds"),
      Stream.mapError(unavailable),
      Stream.runForEach((bytes) =>
        Effect.gen(function* () {
          received += bytes.length;
          if (received > file.bytes) return yield* unavailable();
          hash.update(bytes);
          yield* io(target.writeAll(bytes));
          downloaded += bytes.length;
        }),
      ),
    );
    if (received !== file.bytes || hash.digest("hex") !== file.sha256)
      return yield* failure("generation-failed", "A voice download failed its integrity check.");
  }, Effect.scoped);

  const install = Effect.gen(function* () {
    if (yield* installed) return;
    const temporary = `${root}.tmp`;
    yield* io(fs.makeDirectory(path.dirname(root), { recursive: true }));
    yield* io(fs.remove(temporary, { recursive: true, force: true }));
    yield* io(fs.makeDirectory(temporary, { recursive: true }));
    downloaded = 0;

    yield* Effect.logInfo("read-aloud voice install: downloading English voice");
    yield* download(kokoroArchive, path.join(temporary, kokoroArchive.name));
    yield* Effect.logInfo("read-aloud voice install: unpacking English voice");
    // bsdtar (Windows 10+, macOS) reads .bz2 archives; relative names avoid drive-letter parsing in GNU tar.
    const extracted = yield* runner
      .run({
        // The Windows system tar is bsdtar; a GNU tar earlier on PATH (Git for Windows) is far slower with .bz2.
        command:
          platform === "win32"
            ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
            : "tar",
        args: ["-xjf", kokoroArchive.name],
        cwd: temporary,
        timeout: "10 minutes",
        maxOutputBytes: 1_000_000,
      })
      .pipe(Effect.mapError(() => failure("generation-failed", "Could not unpack the voices.")));
    if (extracted.code !== 0 || extracted.timedOut)
      return yield* failure("generation-failed", "Could not unpack the voices.");
    yield* io(fs.remove(path.join(temporary, kokoroArchive.name)));

    yield* Effect.logInfo("read-aloud voice install: downloading German voice");
    const german = path.join(temporary, "de");
    yield* io(fs.makeDirectory(german, { recursive: true }));
    yield* download(germanFiles.config, path.join(german, germanFiles.config.name));
    yield* download(germanFiles.model, path.join(german, germanFiles.model.name));
    const piper = yield* io(
      fs
        .readFileString(path.join(german, germanFiles.config.name))
        .pipe(Effect.flatMap(decodePiperConfig)),
    );
    yield* io(fs.writeFileString(path.join(german, "tokens.txt"), piperTokens(piper)));
    // Close the file before the directory rename below: Windows refuses to rename a folder with open files.
    yield* io(
      Effect.scoped(
        Effect.gen(function* () {
          const model = yield* fs.open(path.join(german, germanFiles.model.name), { flag: "a" });
          yield* model.writeAll(
            germanModelMetadata(piper.audio.sample_rate, piper.num_speakers ?? 1),
          );
        }),
      ),
    );

    for (const required of [
      path.join(temporary, kokoroArchive.directory, "model.onnx"),
      path.join(temporary, kokoroArchive.directory, "espeak-ng-data"),
      path.join(german, "tokens.txt"),
    ]) {
      if (!(yield* io(fs.exists(required))))
        return yield* failure("generation-failed", "The voice download was incomplete.");
    }
    yield* io(fs.writeFileString(path.join(temporary, "installed.json"), "{}\n"));
    yield* io(fs.remove(root, { recursive: true, force: true }));
    yield* io(fs.rename(temporary, root));
    yield* Effect.logInfo("read-aloud voice install: done");
  }).pipe(Effect.scoped, installing.withPermit);

  const startInstall = Effect.gen(function* () {
    if (installRunning) return;
    installRunning = true;
    installFailed = null;
    yield* install.pipe(
      Effect.catch((error) =>
        Effect.logWarning("read-aloud voice install failed", { message: error.message }).pipe(
          Effect.andThen(
            Effect.sync(() => {
              installFailed = error.message;
            }),
          ),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          installRunning = false;
        }),
      ),
      Effect.forkIn(scope),
    );
  });

  const loadAddon = Effect.fnUntraced(function* () {
    if (addon) return addon;
    const state = yield* artifacts.inspect.pipe(
      Effect.mapError(() => failure("generation-failed", "Could not check the speech runtime.")),
    );
    if (state.runtime._tag !== "installed")
      return yield* failure(
        "voice-unavailable",
        "Turn on dictation once in Settings so the local speech runtime is installed, then try again.",
      );
    const runtimePath = path.join(artifacts.paths("parakeet-v3").runtime, "sherpa-onnx.node");
    addon = yield* Effect.try({
      try: () => NodeModule.createRequire(import.meta.url)(runtimePath) as NativeTtsAddon,
      catch: () => failure("generation-failed", "Could not load the local speech runtime."),
    });
    return addon;
  });

  const configFor = (voice: ReadAloudVoiceId) => {
    const base = {
      numThreads: Math.min(8, Math.max(1, NodeOS.availableParallelism())),
      provider: "cpu",
      debug: 0,
    };
    return voice === "en"
      ? {
          model: {
            kokoro: {
              model: path.join(kokoroDirectory, "model.onnx"),
              voices: path.join(kokoroDirectory, "voices.bin"),
              tokens: path.join(kokoroDirectory, "tokens.txt"),
              dataDir: path.join(kokoroDirectory, "espeak-ng-data"),
              dictDir: path.join(kokoroDirectory, "dict"),
              lexicon: path.join(kokoroDirectory, "lexicon-us-en.txt"),
            },
            ...base,
          },
          maxNumSentences: 1,
        }
      : {
          model: {
            vits: {
              model: path.join(germanDirectory, germanFiles.model.name),
              tokens: path.join(germanDirectory, "tokens.txt"),
              dataDir: path.join(kokoroDirectory, "espeak-ng-data"),
              noiseScale: 0.667,
              noiseScaleW: 0.8,
              lengthScale: 1.0,
            },
            ...base,
          },
          maxNumSentences: 1,
        };
  };

  const synthesize = Effect.fn("ReadAloudEngine.synthesize")(function* (
    voice: ReadAloudVoiceId,
    text: string,
  ) {
    if (!(yield* installed)) {
      yield* startInstall;
      return yield* failure(
        "voice-unavailable",
        installFailed !== null
          ? `${installFailed} Try again to restart the download.`
          : `Downloading the read-aloud voices (${Math.min(99, Math.round((downloaded / totalDownloadBytes) * 100))}%). This happens once; try again in a few minutes.`,
      );
    }
    const native = yield* loadAddon();
    let handle = handles.get(voice);
    if (handle === undefined) {
      handle = yield* Effect.tryPromise({
        try: () => native.createOfflineTtsAsync(configFor(voice)),
        catch: () => failure("generation-failed", "Could not load the local voice."),
      });
      handles.set(voice, handle);
    }
    const voiceHandle = handle;
    return yield* Effect.tryPromise({
      try: () =>
        native.offlineTtsGenerateAsync(voiceHandle, {
          text,
          sid: voice === "en" ? englishSpeakerId : 0,
          speed: 1,
        }),
      catch: () =>
        failure("generation-failed", "Local speech generation failed. Try a shorter reply."),
    }).pipe(
      Effect.timeoutOrElse({
        duration: generationTimeout,
        orElse: () =>
          Effect.fail(
            failure("generation-failed", "Local speech generation timed out. Try a shorter reply."),
          ),
      }),
    );
  });

  return ReadAloudEngine.of({ synthesize, install });
});

export const layer = Layer.effect(ReadAloudEngine, make);
