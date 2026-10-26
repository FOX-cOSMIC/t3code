import type { ReadAloudAudio, ReadAloudInput } from "@t3tools/contracts";

export interface ReadAloudPlaybackState {
  readonly key: string | null;
  readonly phase: "idle" | "loading" | "playing" | "paused" | "ready" | "error";
  readonly error: string | null;
}

export interface ReadAloudDriver {
  readonly load: (
    audio: ReadAloudAudio,
    events: {
      readonly ended: () => void;
      readonly paused: () => void;
      readonly error: () => void;
    },
  ) => Promise<void>;
  readonly play: () => Promise<void>;
  readonly pause: () => void;
  readonly dispose: () => void;
}

export function createReadAloudPlayback(driver: ReadAloudDriver) {
  let state: ReadAloudPlaybackState = { key: null, phase: "idle", error: null };
  let version = 0;
  const listeners = new Set<() => void>();
  const update = (next: ReadAloudPlaybackState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const stop = () => {
    version++;
    driver.dispose();
    update({ key: null, phase: "idle", error: null });
  };
  const resume = async () => {
    const current = version;
    try {
      await driver.play();
      if (current === version) update({ ...state, phase: "playing", error: null });
    } catch {
      if (current === version)
        update({
          ...state,
          phase: "ready",
          error: "Audio is ready. Press Play to start playback.",
        });
    }
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    stop,
    resume,
    pause() {
      driver.pause();
      update({ ...state, phase: "paused" });
    },
    async start(
      key: string,
      input: ReadAloudInput,
      generate: (input: ReadAloudInput) => Promise<ReadAloudAudio>,
    ) {
      stop();
      const current = version;
      update({ key, phase: "loading", error: null });
      try {
        const audio = await generate(input);
        if (current !== version) return;
        await driver.load(audio, {
          ended: () => {
            if (current === version) update({ ...state, phase: "ready" });
          },
          paused: () => {
            if (current === version && state.phase === "playing")
              update({ ...state, phase: "paused" });
          },
          error: () => {
            if (current === version) {
              driver.dispose();
              update({
                ...state,
                phase: "error",
                error: "This device could not play the generated audio.",
              });
            }
          },
        });
        if (current !== version) return;
        await resume();
      } catch (error) {
        if (current !== version) return;
        driver.dispose();
        update({
          key,
          phase: "error",
          error: error instanceof Error ? error.message : "Read aloud failed. Please try again.",
        });
      }
    },
  };
}
