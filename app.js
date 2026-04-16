// Lyrica main app

const MAX_RECORD_SECONDS = 300;
const DEFAULT_MODEL = "Xenova/whisper-small";
const STORAGE_KEY = "lyrica.history.v1";
const THEME_KEY = "lyrica.theme";
const OWNER_KEY = "lyrica.owner";

const $ = (id) => document.getElementById(id);
const mainBtn = $("mainBtn");
const stopBtn = $("stopBtn");
const restartBtn = $("restartBtn");
const uploadBtn = $("uploadBtn");
const fileInput = $("fileInput");
const clearBtn = $("clearBtn");
const modelSel = $("modelSel");
const langSel = $("langSel");
const player = $("player");
const lyricsEl = $("lyrics");
const statusEl = $("status");
const workingArea = $("workingArea");
const workingTitle = $("workingTitle");
const workingSub = $("workingSub");
const workingHint = $("workingHint");
const workingFill = $("workingFill");
const historyList = $("historyList");
const themeBtn = $("themeBtn");
const estText = $("estText");
const estModel = $("estModel");
const ownerPanel = $("ownerPanel");
const voiceIsoToggle = $("voiceIso");

let mediaRecorder = null;
let chunks = [];
let audioBlob = null;
let recordingStream = null;
let lyricLines = [];
let recordTimer = null;
let recordCountdown = null;
let recordStartedAt = 0;
let worker = null;
let jobId = 0;
let currentEntryId = null;
let activeJobTicker = null;

/* ============ THEME ============ */
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  const sun = themeBtn.querySelector(".sun");
  const moon = themeBtn.querySelector(".moon");
  if (sun && moon) {
    sun.style.display = t === "dark" ? "block" : "none";
    moon.style.display = t === "dark" ? "none" : "block";
  }
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) ||
    (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(saved);
}
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
initTheme();

/* ============ OWNER FLAG ============ */
if (localStorage.getItem(OWNER_KEY) === "1") ownerPanel.style.display = "flex";
window.lyrica = {
  setOwner(v = true) {
    localStorage.setItem(OWNER_KEY, v ? "1" : "0");
    ownerPanel.style.display = v ? "flex" : "none";
  },
};

/* ============ WORKER ============ */
function showWorking(title, sub) {
  lyricsEl.style.display = "none";
  workingArea.style.display = "flex";
  workingTitle.textContent = title;
  workingSub.textContent = sub || "";
  workingHint.textContent = "";
  workingFill.style.width = "0%";
}
function updateWorking(opts) {
  if (opts.title) workingTitle.textContent = opts.title;
  if (opts.sub) workingSub.textContent = opts.sub;
  if (opts.hint != null) workingHint.textContent = opts.hint;
  if (opts.fill != null) workingFill.style.width = Math.max(0, Math.min(100, opts.fill)) + "%";
}
function hideWorking() {
  workingArea.style.display = "none";
  lyricsEl.style.display = "flex";
}

function prettyModelName(id) {
  if (id?.includes("tiny")) return "Tiny";
  if (id?.includes("base")) return "Base";
  if (id?.includes("small")) return "Small";
  if (id?.includes("medium")) return "Medium";
  return "voice model";
}

function startWorker() {
  if (worker) return worker;
  worker = new Worker("worker.js", { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "download") {
      updateWorking({
        title: "Warming up for the first time",
        sub: "Downloading the " + prettyModelName(modelSel.value) + " voice model. This happens once, then it's instant.",
        fill: Math.round(m.progress),
        hint: Math.round(m.progress) + "% downloaded",
      });
    } else if (m.type === "download-done") {
      /* continue */
    } else if (m.type === "started") {
      startJobTicker(m.estimatedSeconds);
    } else if (m.type === "result") {
      stopJobTicker();
      updateWorking({ fill: 100 });
      setTimeout(() => { hideWorking(); }, 250);
      finalizeResult(m.id, m.text, m.chunks, m.elapsed);
    } else if (m.type === "error") {
      stopJobTicker();
      hideWorking();
      setStatus("Something went wrong: " + m.message);
      unlockButtons();
    }
  };
  return worker;
}

function startJobTicker(estimated) {
  stopJobTicker();
  const start = performance.now();
  const phases = [
    { t: 0,    title: "Listening to your vocals", sub: "Picking up the melody and words." },
    { t: 0.35, title: "Catching the words",       sub: "Lining up phrases the way you sang them." },
    { t: 0.75, title: "Almost there",             sub: "Cleaning up the last bits." },
  ];
  let phaseIdx = 0;
  updateWorking({ title: phases[0].title, sub: phases[0].sub });
  activeJobTicker = setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    const rel = estimated > 0 ? elapsed / estimated : 0;
    const pct = estimated > 0
      ? Math.min(94, 3 + rel * 91)
      : 3 + ((elapsed * 4) % 91);
    updateWorking({ fill: pct });

    // Phase copy
    const next = phases.findIndex((p) => rel < p.t);
    const idx = (next === -1 ? phases.length : next) - 1;
    if (idx !== phaseIdx && phases[idx]) {
      phaseIdx = idx;
      updateWorking({ title: phases[idx].title, sub: phases[idx].sub });
    }

    // Hint line: elapsed or "taking longer than expected"
    const over = estimated > 0 && elapsed > estimated * 1.2;
    const hint = over
      ? "Taking a little longer on this one. Hang tight."
      : "Elapsed " + formatSec(elapsed) + (estimated ? " of about " + formatSec(estimated) : "");
    updateWorking({ hint });
  }, 300);
}
function formatSec(s) {
  s = Math.max(0, Math.round(s));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return mm > 0 ? mm + "m " + ss + "s" : ss + "s";
}
function stopJobTicker() {
  if (activeJobTicker) { clearInterval(activeJobTicker); activeJobTicker = null; }
}

/* ============ STATUS ============ */
function setStatus(msg, recording = false) {
  statusEl.innerHTML = (recording ? '<span class="dot"></span>' : "") + "<span>" + msg + "</span>";
}

/* ============ AUDIO DECODE + NORMALIZE ============ */
function normalizePcm(pcm, targetPeak = 0.97, targetRms = 0.15) {
  let peak = 0, sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
    sumSq += pcm[i] * pcm[i];
  }
  if (peak === 0) return pcm;
  const rms = Math.sqrt(sumSq / pcm.length);
  const peakGain = targetPeak / peak;
  const rmsGain = rms > 0 ? targetRms / rms : peakGain;
  const gain = Math.min(peakGain, rmsGain);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i] * gain));
  return out;
}

function applyHighpass(pcm, sampleRate = 16000, cutoffHz = 120) {
  // Simple single-pole high-pass to reduce low-end rumble / backing track
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const out = new Float32Array(pcm.length);
  let prevX = 0, prevY = 0;
  for (let i = 0; i < pcm.length; i++) {
    const y = alpha * (prevY + pcm[i] - prevX);
    out[i] = y;
    prevX = pcm[i];
    prevY = y;
  }
  return out;
}

async function blobToMono16k(blob) {
  const arr = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arr);
  let mono;
  if (decoded.numberOfChannels === 1) {
    mono = new Float32Array(decoded.getChannelData(0));
  } else {
    mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
  }
  if (voiceIsoToggle && voiceIsoToggle.checked) mono = applyHighpass(mono);
  return normalizePcm(mono);
}

/* ============ LYRICS CLEANUP ============ */
function cleanLyrics(rawChunks, fallbackText) {
  let chunks = Array.isArray(rawChunks) ? rawChunks.slice() : [];
  const lines = [];
  let lastText = "";
  let repeatRun = 0;

  for (const c of chunks) {
    let text = (c?.text || "").trim();
    // Strip speaker annotations and BLANK_AUDIO tokens
    text = text.replace(/\[[^\]]+\]/g, "");
    text = text.replace(/\*[^*]+\*/g, "");
    text = text.replace(/\([^)]*\b(music|applause|laughter|sniff|cough|bgm|background)\b[^)]*\)/gi, "");
    // Collapse in-line repeats like "X X X X X"
    text = text.replace(/\b([A-Za-z'][\w'-]*(?:\s+[A-Za-z'][\w'-]*){0,4})\b(?:[,.\s]+\1\b){2,}/gi, "$1");
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    if (text.toLowerCase() === lastText.toLowerCase()) {
      repeatRun++;
      if (repeatRun >= 1) continue;
    } else {
      repeatRun = 0;
    }
    lastText = text;

    lines.push({
      text,
      start: Array.isArray(c.timestamp) ? c.timestamp[0] : null,
      end: Array.isArray(c.timestamp) ? c.timestamp[1] : null,
    });
  }

  if (!lines.length && fallbackText) {
    const clean = fallbackText
      .replace(/\[[^\]]+\]/g, "")
      .replace(/\*[^*]+\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean) {
      const parts = clean.split(/(?<=[.?!])\s+|\s*[,;]\s+/).filter(Boolean);
      for (const p of parts) lines.push({ text: p.trim(), start: null, end: null });
    }
  }
  return lines;
}

/* ============ RENDER ============ */
function renderPlaceholder(msg) {
  lyricsEl.innerHTML = '<div class="placeholder">' + msg + "</div>";
  lyricLines = [];
}
function renderLyrics(lines) {
  lyricsEl.innerHTML = "";
  lyricLines = [];
  if (!lines.length) {
    renderPlaceholder("(no clear vocals detected)");
    return;
  }
  for (const line of lines) {
    const el = document.createElement("div");
    el.className = "lyric-line";
    el.textContent = line.text;
    if (line.start != null) {
      el.addEventListener("click", () => {
        try { player.currentTime = line.start; player.play(); } catch {}
      });
    }
    lyricsEl.appendChild(el);
    lyricLines.push({ ...line, el });
  }
}
function updateActiveLyric() {
  if (!lyricLines.length) return;
  const t = player.currentTime || 0;
  let activeIdx = -1;
  for (let i = 0; i < lyricLines.length; i++) {
    const line = lyricLines[i];
    if (line.start == null) continue;
    const end = line.end != null ? line.end : (lyricLines[i + 1]?.start ?? Infinity);
    if (t >= line.start && t < end) { activeIdx = i; break; }
    if (t >= line.start) activeIdx = i;
  }
  lyricLines.forEach((line, i) => {
    line.el.classList.toggle("active", i === activeIdx);
    line.el.classList.toggle("past", activeIdx >= 0 && i < activeIdx);
  });
}
player.addEventListener("timeupdate", updateActiveLyric);
player.addEventListener("seeked", updateActiveLyric);

/* ============ HISTORY ============ */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveHistory(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
function addHistoryEntry(entry) {
  const list = loadHistory();
  list.unshift(entry);
  saveHistory(list.slice(0, 50));
  renderHistory();
}
function updateHistoryName(id, name) {
  const list = loadHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return;
  list[idx].name = name;
  saveHistory(list);
  renderHistory();
}
function deleteHistoryEntry(id) {
  saveHistory(loadHistory().filter((e) => e.id !== id));
  if (currentEntryId === id) currentEntryId = null;
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  if (!list.length) {
    historyList.innerHTML = '<div class="history-empty">No transcripts yet.</div>';
    return;
  }
  historyList.innerHTML = "";
  for (const e of list) {
    const item = document.createElement("div");
    item.className = "history-item" + (e.id === currentEntryId ? " active" : "");
    const top = document.createElement("div");
    top.className = "hi-top";
    const name = document.createElement("div");
    name.className = "hi-name";
    name.textContent = e.name || "Untitled";
    name.title = e.name || "Untitled";
    top.appendChild(name);

    const renameBtn = document.createElement("button");
    renameBtn.className = "mini";
    renameBtn.title = "Rename";
    renameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>';
    renameBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startRename(item, e);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "mini";
    delBtn.title = "Delete";
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>';
    delBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (confirm("Delete this transcript?")) deleteHistoryEntry(e.id);
    });

    top.appendChild(renameBtn);
    top.appendChild(delBtn);

    const preview = document.createElement("div");
    preview.className = "hi-preview";
    preview.textContent = e.lines?.map((l) => l.text).join(" ") || "";

    const meta = document.createElement("div");
    meta.className = "hi-meta";
    meta.textContent = new Date(e.createdAt).toLocaleString() +
      " · " + (e.modelId?.split("/")[1] || "") +
      " · " + Math.round(e.durationSec || 0) + "s";

    item.appendChild(top);
    item.appendChild(preview);
    item.appendChild(meta);

    item.addEventListener("click", () => loadEntry(e.id));
    historyList.appendChild(item);
  }
}
function startRename(item, entry) {
  const top = item.querySelector(".hi-top");
  const oldName = top.querySelector(".hi-name");
  const input = document.createElement("input");
  input.className = "hi-name";
  input.value = entry.name || "";
  top.replaceChild(input, oldName);
  input.focus();
  input.select();
  const commit = () => {
    const v = input.value.trim() || "Untitled";
    updateHistoryName(entry.id, v);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.blur();
    if (ev.key === "Escape") { input.value = entry.name || ""; input.blur(); }
  });
}
function loadEntry(id) {
  const list = loadHistory();
  const e = list.find((x) => x.id === id);
  if (!e) return;
  currentEntryId = id;
  renderLyrics(e.lines);
  setStatus("Loaded: " + (e.name || "Untitled"));
  player.removeAttribute("src");
  player.load();
  renderHistory();
}

renderHistory();

/* ============ RECORDING ============ */
async function startRecording() {
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
  } catch (err) {
    setStatus("Mic error: " + err.message);
    return;
  }
  chunks = [];
  const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
  mediaRecorder = new MediaRecorder(recordingStream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : {});
  mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    clearRecordTimers();
    audioBlob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
    player.src = URL.createObjectURL(audioBlob);
    recordingStream?.getTracks().forEach((t) => t.stop());
    recordingStream = null;
    await transcribeNow();
  };
  mediaRecorder.start();
  recordStartedAt = Date.now();
  mainBtn.disabled = true;
  stopBtn.disabled = false;
  restartBtn.disabled = false;
  clearBtn.disabled = true;
  renderPlaceholder("Listening...");
  const tick = () => {
    const elapsed = Math.floor((Date.now() - recordStartedAt) / 1000);
    const remaining = Math.max(0, MAX_RECORD_SECONDS - elapsed);
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    setStatus("Recording, " + mm + ":" + ss + " left (5 min max).", true);
  };
  tick();
  recordCountdown = setInterval(tick, 500);
  recordTimer = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      setStatus("Hit the 5-minute limit. Wrapping up.");
      mediaRecorder.stop();
    }
  }, MAX_RECORD_SECONDS * 1000);
}

function clearRecordTimers() {
  if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
  if (recordCountdown) { clearInterval(recordCountdown); recordCountdown = null; }
}

function unlockButtons() {
  mainBtn.disabled = false;
  stopBtn.disabled = true;
  restartBtn.disabled = true;
  clearBtn.disabled = false;
}

/* ============ TRANSCRIBE ============ */
function estimateSeconds(audioSeconds, modelId) {
  // Realistic multipliers for WASM Whisper in-browser on mid-range desktop.
  // Multiplier = processing / audio duration (lower = faster than realtime).
  const m = modelId.includes("tiny") ? 0.25
    : modelId.includes("base") ? 0.5
    : modelId.includes("small") ? 1.2
    : 2.5; // medium
  return audioSeconds * m;
}

async function transcribeNow() {
  if (!audioBlob) return;
  try {
    mainBtn.disabled = true; stopBtn.disabled = true; restartBtn.disabled = true; clearBtn.disabled = true;
    showWorking("Getting your audio ready", "One moment.");
    setStatus("Working on it...");

    const audio = await blobToMono16k(audioBlob);
    const durationSec = audio.length / 16000;
    const modelId = modelSel.value || DEFAULT_MODEL;
    const lang = langSel.value;
    const estimated = estimateSeconds(durationSec, modelId);

    updateWorking({
      title: "Listening to your vocals",
      sub: "Should take about " + formatSec(estimated) + ". The page stays responsive, you can keep it open.",
      fill: 3,
    });

    startWorker();
    const id = ++jobId;
    currentEntryId = null;
    renderHistory();
    worker.postMessage({
      type: "transcribe",
      id,
      modelId,
      audio,
      language: lang,
      estimatedSeconds: estimated,
      durationSec,
    }, [audio.buffer]);
  } catch (err) {
    console.error(err);
    hideWorking();
    setStatus("Something went wrong: " + err.message);
    unlockButtons();
  }
}

function finalizeResult(id, text, rawChunks, elapsed) {
  if (id !== jobId) return;
  const lines = cleanLyrics(rawChunks, text);
  renderLyrics(lines);

  const entry = {
    id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    name: "Untitled · " + new Date().toLocaleString(),
    lines,
    modelId: modelSel.value || DEFAULT_MODEL,
    lang: langSel.value,
    createdAt: Date.now(),
    durationSec: Math.round(elapsed || 0),
  };
  currentEntryId = entry.id;
  addHistoryEntry(entry);
  setStatus("Here are your lyrics. Tap a line to replay that moment.");
  unlockButtons();
}

/* ============ BUTTON WIRING ============ */
mainBtn.addEventListener("click", startRecording);

stopBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    setStatus("Stopping...");
    mediaRecorder.stop();
  }
});

restartBtn.addEventListener("click", async () => {
  // discard current take, start fresh
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.onstop = () => {
      clearRecordTimers();
      recordingStream?.getTracks().forEach((t) => t.stop());
      recordingStream = null;
      audioBlob = null;
      chunks = [];
      startRecording();
    };
    mediaRecorder.stop();
  } else {
    audioBlob = null;
    chunks = [];
    player.removeAttribute("src");
    player.load();
    startRecording();
  }
});

uploadBtn.addEventListener("click", () => fileInput.click());
const ALLOWED_EXT = /\.(mp3|m4a|aac|ogg|webm)$/i;
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (!ALLOWED_EXT.test(file.name)) {
    renderPlaceholder("Upload MP3, M4A, AAC, OGG or WEBM. WAV/FLAC conversion coming soon.");
    setStatus("Unsupported format: " + file.name);
    fileInput.value = "";
    return;
  }
  audioBlob = file;
  player.src = URL.createObjectURL(file);
  setStatus("Loaded " + file.name + ". Starting now.");
  fileInput.value = "";
  await transcribeNow();
});

clearBtn.addEventListener("click", () => {
  clearRecordTimers();
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  recordingStream?.getTracks().forEach((t) => t.stop());
  recordingStream = null;
  mediaRecorder = null;
  chunks = [];
  audioBlob = null;
  currentEntryId = null;
  player.removeAttribute("src");
  player.load();
  renderPlaceholder("Your lyrics will appear here, line by line.");
  setStatus("Cleared.");
  unlockButtons();
  renderHistory();
});

/* ============ ESTIMATES ============ */
function updateEstimateLabel() {
  const m = modelSel.value;
  const label = m.includes("tiny") ? "Tiny · fastest, lowest accuracy"
    : m.includes("base") ? "Base · fast"
    : m.includes("small") ? "Small · balanced"
    : "Medium · most accurate, slowest";
  estModel.textContent = label;
  estText.textContent = m.includes("tiny") ? "≈1 min for 5-min audio"
    : m.includes("base") ? "≈2-3 min for 5-min audio"
    : m.includes("small") ? "≈5-6 min for 5-min audio"
    : "≈12-15 min for 5-min audio";
}
modelSel.addEventListener("change", updateEstimateLabel);
updateEstimateLabel();
