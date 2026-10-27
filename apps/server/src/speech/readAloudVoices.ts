/**
 * Local read-aloud voices: Kokoro (English, sherpa-onnx archive with the espeak data) and Piper
 * Thorsten (German, from Hugging Face). Piper files need metadata and tokens added after download.
 */

export type ReadAloudVoiceId = "en" | "de";

const piperRevision = "5041a7a49ae5b3a0f30e6837769eb03fdbb231bd";
const piperBase = `https://huggingface.co/rhasspy/piper-voices/resolve/${piperRevision}/de/de_DE/thorsten/medium`;

export const kokoroArchive = {
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2",
  name: "kokoro-multi-lang-v1_1.tar.bz2",
  directory: "kokoro-multi-lang-v1_1",
  bytes: 364_855_331,
  sha256: "b78e1ac42b852e839cceaafbe88f66806bf5860992d1d7b9a3f2ad1198427aed",
} as const;

export const germanFiles = {
  model: {
    url: `${piperBase}/de_DE-thorsten-medium.onnx`,
    name: "de_DE-thorsten-medium.onnx",
    bytes: 63_201_294,
    sha256: "7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819",
  },
  config: {
    url: `${piperBase}/de_DE-thorsten-medium.onnx.json`,
    name: "de_DE-thorsten-medium.onnx.json",
    bytes: 4_819,
    sha256: "974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85",
  },
} as const;

/** Total download for both voices, for progress reporting. */
export const totalDownloadBytes =
  kokoroArchive.bytes + germanFiles.model.bytes + germanFiles.config.bytes;

/** Kokoro speaker id used for English. */
export const englishSpeakerId = 0;

/** Piper `phoneme_id_map` as the `symbol id` lines sherpa-onnx reads as tokens.txt. */
export function piperTokens(config: unknown): string {
  const map =
    typeof config === "object" && config !== null && "phoneme_id_map" in config
      ? (config.phoneme_id_map as Record<string, unknown>)
      : null;
  if (map === null || typeof map !== "object") throw new Error("Piper config has no phoneme map.");
  const lines: string[] = [];
  for (const [symbol, ids] of Object.entries(map)) {
    const id = Array.isArray(ids) ? ids[0] : undefined;
    if (typeof id !== "number" || !Number.isInteger(id)) throw new Error("Invalid phoneme id.");
    lines.push(`${symbol} ${id}`);
  }
  return `${lines.join("\n")}\n`;
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

function protobufString(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes]);
}

/**
 * Bytes to append to an ONNX file to add `metadata_props` (ModelProto field 14).
 * Protobuf merges repeated fields appended at the end, so the model graph stays untouched.
 */
export function onnxMetadata(entries: Readonly<Record<string, string>>): Buffer {
  return Buffer.concat(
    Object.entries(entries).map(([key, value]) => {
      const entry = Buffer.concat([protobufString(1, key), protobufString(2, value)]);
      return Buffer.concat([varint((14 << 3) | 2), varint(entry.length), entry]);
    }),
  );
}

export function germanModelMetadata(sampleRate: number, speakers: number) {
  return onnxMetadata({
    comment: "piper",
    model_type: "vits",
    language: "German",
    voice: "de",
    has_espeak: "1",
    n_speakers: String(speakers),
    sample_rate: String(sampleRate),
    add_blank: "1",
  });
}

/** 16-bit mono WAV from float samples in [-1, 1]. */
export function wavFromSamples(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    data.writeInt16LE(Math.round(clamped * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
