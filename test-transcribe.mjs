import { pipeline, env } from "@xenova/transformers";
import { readFileSync } from "node:fs";
import { WaveFile } from "wavefile";

env.allowLocalModels = false;
env.cacheDir = "./.cache";

const FILE = process.argv[2] || "C:/Users/lucas/Music/Demo Instrumentals/test sample normalize volume too in code.wav";
const MODEL = process.argv[3] || "Xenova/whisper-small";
const LANG = process.argv[4] || "en";

console.log("File:", FILE);
console.log("Model:", MODEL);
console.log("Lang:", LANG);

const buf = readFileSync(FILE);
const wav = new WaveFile(buf);
wav.toBitDepth("32f");
wav.toSampleRate(16000);

let samples = wav.getSamples();
if (Array.isArray(samples)) {
  const len = samples[0].length;
  const merged = new Float32Array(len);
  for (let ch = 0; ch < samples.length; ch++) {
    for (let i = 0; i < len; i++) merged[i] += samples[ch][i] / samples.length;
  }
  samples = merged;
} else {
  samples = Float32Array.from(samples);
}

function normalize(pcm, targetPeak = 0.97, targetRms = 0.15) {
  let peak = 0, sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
    sumSq += pcm[i] * pcm[i];
  }
  const rms = Math.sqrt(sumSq / pcm.length);
  if (peak === 0) return pcm;
  const peakGain = targetPeak / peak;
  const rmsGain = rms > 0 ? targetRms / rms : peakGain;
  const gain = Math.min(peakGain, rmsGain);
  console.log(`peak=${peak.toFixed(4)} rms=${rms.toFixed(4)} gain=${gain.toFixed(3)}`);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i] * gain));
  return out;
}

samples = normalize(samples);
console.log("duration:", (samples.length / 16000).toFixed(2), "s");

console.log("Loading model...");
const t = await pipeline("automatic-speech-recognition", MODEL, {
  progress_callback: (p) => {
    if (p.status === "progress" && p.progress != null) {
      process.stdout.write(`\r${p.file} ${Math.round(p.progress)}%   `);
    }
  },
});
console.log("\nTranscribing...");

const result = await t(samples, {
  chunk_length_s: 30,
  stride_length_s: 5,
  return_timestamps: true,
  language: LANG,
  task: "transcribe",
  no_speech_threshold: 0.2,
  condition_on_previous_text: false,
  temperature: 0,
});

console.log("\n=== TEXT ===\n" + (result.text || "").trim() + "\n");
console.log("=== LINES ===");
for (const c of result.chunks || []) {
  const [s, e] = c.timestamp || [0, 0];
  console.log(`[${(s ?? 0).toFixed(1)}s] ${(c.text || "").trim()}`);
}
