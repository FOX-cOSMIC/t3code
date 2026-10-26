import {
  createReadAloudPlayback,
  type ReadAloudDriver,
} from "@t3tools/client-runtime/read-aloud-playback";

let player: HTMLAudioElement | null = null;
let url: string | null = null;

const driver: ReadAloudDriver = {
  async load(audio, events) {
    const bytes = Uint8Array.from(atob(audio.audioBase64), (character) => character.charCodeAt(0));
    url = URL.createObjectURL(new Blob([bytes], { type: audio.mimeType }));
    player = new Audio(url);
    player.onended = events.ended;
    player.onpause = events.paused;
    player.onerror = events.error;
  },
  async play() {
    if (!player) throw new Error("Audio is not ready.");
    await player.play();
  },
  pause() {
    player?.pause();
  },
  dispose() {
    if (player) {
      player.onended = null;
      player.onpause = null;
      player.onerror = null;
      player.pause();
      player.removeAttribute("src");
      player.load();
      player = null;
    }
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  },
};

export const readAloudPlayback = createReadAloudPlayback(driver);
