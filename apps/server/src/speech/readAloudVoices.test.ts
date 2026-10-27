import { describe, expect, it } from "vite-plus/test";
import { onnxMetadata, piperTokens, wavFromSamples } from "./readAloudVoices.ts";

describe("read-aloud voice helpers", () => {
  it("turns a Piper phoneme map into sherpa-onnx tokens", () => {
    expect(piperTokens({ phoneme_id_map: { _: [0], "^": [1], ä: [30] } })).toBe("_ 0\n^ 1\nä 30\n");
    expect(() => piperTokens({})).toThrow();
    expect(() => piperTokens({ phoneme_id_map: { a: ["x"] } })).toThrow();
  });

  it("encodes ONNX metadata_props as appendable protobuf fields", () => {
    // metadata_props (field 14, length 9) holding key (field 1) "ab" and value (field 2) "cde".
    const bytes = onnxMetadata({ ab: "cde" });
    expect([...bytes]).toEqual([0x72, 9, 0x0a, 2, 0x61, 0x62, 0x12, 3, 0x63, 0x64, 0x65]);
    expect(onnxMetadata({}).length).toBe(0);
  });

  it("writes a valid 16-bit mono WAV and clamps samples", () => {
    const wav = wavFromSamples(new Float32Array([0, 0.5, -2, 2]), 22050);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.readInt16LE(44 + 4)).toBe(-32767);
    expect(wav.readInt16LE(44 + 6)).toBe(32767);
    expect(wav.length).toBe(44 + 8);
  });
});
