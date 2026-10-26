import { expect, it, vi } from "vite-plus/test";
import { readAloudPlayback } from "./readAloudPlayback";

it("releases browser audio and its blob when playback is stopped or replaced", async () => {
  let current: FakeAudio | undefined;
  class FakeAudio {
    onended: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(async () => {});
    pause = vi.fn();
    removeAttribute = vi.fn();
    load = vi.fn();
    constructor(_url: string) {
      current = this;
    }
  }
  using createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-speech");
  using revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("Audio", FakeAudio);
  try {
    await readAloudPlayback.start("reply", { text: "Hello", language: "en" }, async () => ({
      audioBase64: "AAAA",
      mimeType: "audio/wav",
    }));
    const first = current!;
    expect(createUrl).toHaveBeenCalledOnce();
    expect(first.play).toHaveBeenCalledOnce();
    await readAloudPlayback.start("next", { text: "Hallo", language: "de" }, async () => ({
      audioBase64: "AAAA",
      mimeType: "audio/wav",
    }));
    expect(first.pause).toHaveBeenCalledOnce();
    expect(first.removeAttribute).toHaveBeenCalledWith("src");
    expect(first.load).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledOnce();
    readAloudPlayback.stop();
    expect(current!.onended).toBeNull();
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  } finally {
    readAloudPlayback.stop();
    vi.unstubAllGlobals();
  }
});
