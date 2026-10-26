import { describe, expect, it } from "vite-plus/test";
import { readAloudText } from "./readAloud.ts";

describe("readAloudText", () => {
  it("reads prose and link labels, but skips code blocks, images, tables and HTML", () => {
    expect(
      readAloudText(
        "# Hello\n\n**English** and *Deutsch*: [help](https://example.com).\n\n```ts\nsecretCode();\n```\n\n![image](photo.png)\n\n| Code | Value |\n| --- | --- |\n| a | b |\n\n<script>doNotRead()</script>\n\nUse `SSD`.",
      ),
    ).toBe("Hello\nEnglish and Deutsch: help.\nUse SSD.");
  });

  it("preserves German characters, lists and literal punctuation", () => {
    expect(readAloudText("- Grüße aus Köln.\n- Zwei SSDs & 3 GPUs.")).toBe(
      "Grüße aus Köln.\nZwei SSDs & 3 GPUs.",
    );
    expect(readAloudText("```\ncode only\n```")).toBe("");
  });
});
