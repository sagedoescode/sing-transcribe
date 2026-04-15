# Sing Transcribe

Local web app to transcribe singing (or speech) with Whisper running in the browser. Free, no uploads, no API keys.

## Run

```bash
cd sing-transcribe
npm start
```

Then open http://localhost:5173

> Microphone access requires `localhost` or HTTPS. Serving from `file://` will block the mic.

## Use

1. Click **Record**, sing, click **Stop**.
2. Pick model size and language.
3. Click **Transcribe**.

First run downloads the Whisper model to your browser cache (tiny ~75MB, base ~145MB, small ~480MB). Later runs are instant.

## Notes

- Whisper handles singing reasonably well, especially with `small`.
- For cleaner results, record isolated vocals (not the instrumental mix).
- Everything runs client side via `@xenova/transformers` (WASM + WebGPU when available).
