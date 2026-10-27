import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as ServerConfig from "../config.ts";
import * as DictationArtifacts from "../dictation/DictationArtifacts.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ReadAloudEngine } from "./ReadAloud.ts";
import * as Engine from "./ReadAloudEngine.ts";

/**
 * Run explicitly with a base directory whose `userdata/dictation/runtime` already holds the native
 * runtime (copy it from a dictation install). Downloads the real voices (~430 MB) on the first run.
 */
const home = process.env.T3_READ_ALOUD_E2E_HOME;

it.live.skipIf(!home)("downloads the voices and speaks English and German", () =>
  Effect.gen(function* () {
    const engine = yield* ReadAloudEngine;
    yield* engine.install;
    const english = yield* engine.synthesize(
      "en",
      "Read aloud now uses a local voice on this computer.",
    );
    const german = yield* engine.synthesize(
      "de",
      "Vorlesen nutzt jetzt eine lokale Stimme auf diesem Rechner.",
    );
    for (const audio of [english, german]) {
      assert.isAbove(audio.samples.length, audio.sampleRate);
      assert.isTrue(audio.samples.some((sample) => Math.abs(sample) > 0.05));
    }
  }).pipe(
    Effect.provide(
      Engine.layer.pipe(
        Layer.provide(DictationArtifacts.layer),
        Layer.provide(ProcessRunner.layer),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(ServerConfig.layerTest(process.cwd(), home!)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  ),
);
