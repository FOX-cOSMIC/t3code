import {
  createReadAloudPlayback,
  type ReadAloudDriver,
} from "@t3tools/client-runtime/read-aloud-playback";
import { createAudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { AppState } from "react-native";
import { createAudioPlaybackSession, disposeAudioPlayer } from "./audioSession";
import { uuidv4 } from "./uuid";

let player: ReturnType<typeof createAudioPlayer> | null = null;
let playback: ReturnType<typeof createAudioPlaybackSession> | null = null;
let file: File | null = null;
let statusSubscription: { remove(): void } | null = null;
let appSubscription: { remove(): void } | null = null;
let version = 0;

const driver: ReadAloudDriver = {
  async load(audio, events) {
    const current = ++version;
    const candidate = new File(Paths.cache, `t3-read-aloud-${uuidv4()}.wav`);
    try {
      candidate.create();
      await candidate.write(audio.audioBase64, { encoding: "base64" });
      if (current !== version) {
        candidate.delete();
        return;
      }
      file = candidate;
      const next = createAudioPlayer(candidate.uri, { updateInterval: 500 });
      player = next;
      playback = createAudioPlaybackSession(next, false, (requested) => {
        if (!requested) events.paused();
      });
      statusSubscription = next.addListener("playbackStatusUpdate", (status) => {
        if (status.error) {
          playback?.pause();
          events.error();
        } else if (status.didJustFinish) {
          playback?.pause();
          events.ended();
        }
      });
      appSubscription = AppState.addEventListener("change", (state) => {
        if (state !== "active") playback?.pause();
      });
    } catch (error) {
      if (candidate.exists) candidate.delete();
      throw error;
    }
  },
  async play() {
    if (!player || !playback) throw new Error("Audio is not ready.");
    const current = player;
    await playback.play(
      current.duration > 0 && current.currentTime >= current.duration
        ? () => current.seekTo(0)
        : undefined,
    );
  },
  pause() {
    playback?.pause();
  },
  dispose() {
    version++;
    statusSubscription?.remove();
    statusSubscription = null;
    appSubscription?.remove();
    appSubscription = null;
    playback?.pause();
    playback = null;
    if (player) {
      disposeAudioPlayer(player);
      player = null;
    }
    if (file) {
      try {
        if (file.exists) file.delete();
      } catch {
      } finally {
        file = null;
      }
    }
  },
};

export const readAloudPlayback = createReadAloudPlayback(driver);
