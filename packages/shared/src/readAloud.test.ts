import { describe, expect, it } from "vite-plus/test";
import { detectReadAloudLanguage, readAloudText } from "./readAloud.ts";

describe("detectReadAloudLanguage", () => {
  it("detects English and German prose", () => {
    expect(detectReadAloudLanguage("This is a test of the voice that you can use.")).toBe("en");
    expect(detectReadAloudLanguage("Das ist ein Test der Stimme, die Sie nutzen können.")).toBe(
      "de",
    );
    expect(detectReadAloudLanguage("Grüße aus Köln, wir sind schon über der Straße.")).toBe("de");
  });

  it("falls back to English without evidence and follows the majority in mixed text", () => {
    expect(detectReadAloudLanguage("")).toBe("en");
    expect(detectReadAloudLanguage("SSD NVMe 1234")).toBe("en");
    expect(
      detectReadAloudLanguage(
        "Der Server ist nicht erreichbar und die Anfrage wurde abgelehnt, use the fix.",
      ),
    ).toBe("de");
  });
});

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
