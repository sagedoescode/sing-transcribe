import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
env.allowLocalModels = false;

let transcriber = null;
let loadedModel = null;

async function load(modelId) {
  if (transcriber && loadedModel === modelId) return;
  transcriber = await pipeline("automatic-speech-recognition", modelId, {
    progress_callback: (p) => {
      if (p.status === "progress" && p.progress != null) {
        self.postMessage({ type: "download", file: p.file, progress: p.progress });
      } else if (p.status === "done") {
        self.postMessage({ type: "download-done", file: p.file });
      }
    },
  });
  loadedModel = modelId;
}

self.onmessage = async (e) => {
  const { type, id } = e.data;
  try {
    if (type === "load") {
      await load(e.data.modelId);
      self.postMessage({ type: "loaded", id });
    } else if (type === "transcribe") {
      const { modelId, audio, language, estimatedSeconds } = e.data;
      await load(modelId);
      self.postMessage({ type: "started", id, estimatedSeconds });

      const start = performance.now();
      const opts = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        no_speech_threshold: 0.3,
        condition_on_previous_text: false,
        temperature: 0,
        compression_ratio_threshold: 2.2,
        logprob_threshold: -1.0,
        repetition_penalty: 1.2,
        no_repeat_ngram_size: 3,
      };
      if (language && language !== "auto") {
        opts.language = language;
        opts.task = "transcribe";
      }
      const result = await transcriber(audio, opts);
      const elapsed = (performance.now() - start) / 1000;
      self.postMessage({ type: "result", id, text: result.text, chunks: result.chunks, elapsed });
    }
  } catch (err) {
    self.postMessage({ type: "error", id, message: err?.message || String(err) });
  }
};
