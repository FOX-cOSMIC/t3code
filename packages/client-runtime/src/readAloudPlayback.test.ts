import { describe, expect, it, vi } from "vite-plus/test";
import { createReadAloudPlayback, type ReadAloudDriver } from "./readAloudPlayback.ts";

const audio = { audioBase64: "AAAA", mimeType: "audio/wav" as const };
const input = { text: "Hello", language: "en" as const };

function setup() {
  let events: Parameters<ReadAloudDriver["load"]>[1] | undefined;
  const driver = {
    load: vi.fn(async (_audio, callbacks) => {
      events = callbacks;
    }),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    dispose: vi.fn(),
  } satisfies ReadAloudDriver;
  return { driver, controller: createReadAloudPlayback(driver), events: () => events! };
}

describe("read aloud playback", () => {
  it("supports playback, pause, resume, completion and resource release", async () => {
    const { controller, driver, events } = setup();
    await controller.start("reply", input, async () => audio);
    expect(controller.snapshot().phase).toBe("playing");
    controller.pause();
    expect(controller.snapshot().phase).toBe("paused");
    expect(driver.pause).toHaveBeenCalledOnce();
    await controller.resume();
    events().ended();
    expect(controller.snapshot().phase).toBe("ready");
    controller.stop();
    expect(controller.snapshot().key).toBeNull();
    expect(driver.dispose).toHaveBeenCalledTimes(2);
  });

  it("ignores an old generation when the user switches replies or presses stop", async () => {
    const { controller, driver } = setup();
    let finish!: (value: typeof audio) => void;
    const pending = controller.start(
      "old",
      input,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await controller.start("new", input, async () => audio);
    finish(audio);
    await pending;
    expect(controller.snapshot().key).toBe("new");
    expect(driver.load).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("does not start late audio after cancellation or unmount", async () => {
    const { controller, driver } = setup();
    const unsubscribe = controller.subscribe(() => {});
    let finish!: (value: typeof audio) => void;
    const pending = controller.start(
      "reply",
      input,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    unsubscribe();
    finish(audio);
    await pending;
    expect(driver.load).not.toHaveBeenCalled();
    expect(controller.snapshot().phase).toBe("idle");
  });

  it("offers manual playback when a browser blocks automatic playback", async () => {
    const { controller, driver } = setup();
    driver.play.mockRejectedValueOnce(new Error("NotAllowedError"));
    await controller.start("reply", input, async () => audio);
    expect(controller.snapshot().phase).toBe("ready");
    await controller.resume();
    expect(controller.snapshot().phase).toBe("playing");
    controller.stop();
  });

  it("surfaces generation and playback errors, and notices external pauses", async () => {
    const { controller, events } = setup();
    await controller.start("reply", input, async () => {
      throw new Error("German voice is unavailable");
    });
    expect(controller.snapshot().error).toBe("German voice is unavailable");
    await controller.start("reply", input, async () => audio);
    events().paused();
    expect(controller.snapshot().phase).toBe("paused");
    events().error();
    expect(controller.snapshot().phase).toBe("error");
    controller.stop();
  });
});
