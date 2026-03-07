import {
  MAX_FRAMES,
  PKT_IMG,
  THEME_STORAGE_KEY,
  THEMES,
  clamp,
  log,
  state,
  ui,
} from "./matrix_8_ble_web_app.context.js";

const hooks = {
  scheduleLivePreview: () => {},
  renderFrames: () => {},
};
const THEME_CHROME_COLORS = {
  rose: "#ef6ea2",
  sky: "#5e93ff",
  mint: "#4cbf9f",
  sunset: "#f08b61",
};
let brightnessAutoTimer = null;
let brightnessPendingValue = null;
let brightnessLastSentValue = null;
let globalPointerUpBound = false;
let textPreviewTimer = null;
let textPreviewFrames = [];
let textPreviewIndex = 0;
let animPreviewTimer = null;
let animPreviewIndex = 0;
let animToggleState = "idle";
const addFrameEditorState = {
  grid: Array.from({ length: 8 }, () => Array(8).fill(false)),
  drawActive: false,
  drawValue: true,
  lastPaintedKey: "",
  open: false,
  editIndex: -1,
};

function emptyRows8() {
  return Array(8).fill(0);
}

function rowsToAddFrameEditor(rows) {
  for (let r = 0; r < 8; r++) {
    const row = rows[r] || 0;
    for (let c = 0; c < 8; c++) {
      addFrameEditorState.grid[r][c] = ((row >> (7 - c)) & 1) === 1;
    }
  }
}

function addFrameEditorToRows() {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = 0;
    for (let c = 0; c < 8; c++) {
      if (addFrameEditorState.grid[r][c]) row |= (1 << (7 - c));
    }
    rows.push(row);
  }
  return rows;
}

function rotateAddFrameEditorCCW() {
  const next = Array.from({ length: 8 }, () => Array(8).fill(false));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      next[7 - c][r] = addFrameEditorState.grid[r][c];
    }
  }
  addFrameEditorState.grid = next;
}

function renderAddFrameEditorGrid() {
  if (!ui.addFrameGrid) return;
  ui.addFrameGrid.querySelectorAll(".px").forEach((cell) => {
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    cell.classList.toggle("on", addFrameEditorState.grid[r][c]);
  });
}

function createAddFrameEditorGrid() {
  if (!ui.addFrameGrid) return;
  if (ui.addFrameGrid.childElementCount === 64) return;

  ui.addFrameGrid.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "px";
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);

      cell.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        addFrameEditorState.drawActive = true;
        addFrameEditorState.drawValue = !addFrameEditorState.grid[r][c];
        addFrameEditorState.grid[r][c] = addFrameEditorState.drawValue;
        addFrameEditorState.lastPaintedKey = `${r},${c}`;
        ui.addFrameGrid.setPointerCapture?.(ev.pointerId);
        renderAddFrameEditorGrid();
      });

      cell.addEventListener("pointerenter", () => {
        if (!addFrameEditorState.drawActive) return;
        addFrameEditorState.grid[r][c] = addFrameEditorState.drawValue;
        renderAddFrameEditorGrid();
      });

      ui.addFrameGrid.appendChild(cell);
    }
  }

  ui.addFrameGrid.addEventListener("pointermove", (ev) => {
    if (!addFrameEditorState.drawActive) return;
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!(target instanceof HTMLElement) || !target.classList.contains("px")) return;

    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;

    const key = `${r},${c}`;
    if (key === addFrameEditorState.lastPaintedKey) return;
    addFrameEditorState.lastPaintedKey = key;

    if (addFrameEditorState.grid[r][c] !== addFrameEditorState.drawValue) {
      addFrameEditorState.grid[r][c] = addFrameEditorState.drawValue;
      renderAddFrameEditorGrid();
    }
  });

  ui.addFrameGrid.addEventListener("pointerup", () => {
    addFrameEditorState.drawActive = false;
    addFrameEditorState.lastPaintedKey = "";
  });

  ui.addFrameGrid.addEventListener("pointercancel", () => {
    addFrameEditorState.drawActive = false;
    addFrameEditorState.lastPaintedKey = "";
  });

  window.addEventListener("pointerup", () => {
    addFrameEditorState.drawActive = false;
    addFrameEditorState.lastPaintedKey = "";
  });
}

function closeAddFrameEditor() {
  if (!ui.addFrameModal) return;
  ui.addFrameModal.hidden = true;
  document.body.classList.remove("modal-open");
  addFrameEditorState.drawActive = false;
  addFrameEditorState.lastPaintedKey = "";
  addFrameEditorState.editIndex = -1;
  addFrameEditorState.open = false;
}

function openAddFrameEditor(frameToEdit = null, editIndex = -1) {
  if (!ui.addFrameModal || !ui.addFrameGrid) return;
  const isEdit = editIndex >= 0 && frameToEdit;
  if (!isEdit && state.frames.length >= MAX_FRAMES) {
    alert(`Maksimum ${MAX_FRAMES} kare.`);
    return;
  }

  createAddFrameEditorGrid();
  if (isEdit) {
    rowsToAddFrameEditor(frameToEdit.rows || emptyRows8());
  } else {
    rowsToAddFrameEditor(gridToRows());
  }
  renderAddFrameEditorGrid();

  if (ui.addFrameDurationInput) {
    const durationValue = isEdit ? frameToEdit.duration : ui.frameDurationInput?.value;
    ui.addFrameDurationInput.value = String(clamp(durationValue, 40, 1200, 150));
  }
  if (ui.addFrameBrightnessInput) {
    const brightnessValue = isEdit
      ? frameToEdit.brightness
      : (ui.frameBrightnessInput?.value ?? ui.brightnessRange?.value);
    ui.addFrameBrightnessInput.value = String(clamp(brightnessValue, 0, 15, 8));
  }
  if (ui.addFrameSaveBtn) {
    const label = ui.addFrameSaveBtn.querySelector("span");
    if (label) label.textContent = isEdit ? "Kareyi Güncelle" : "Kareyi Ekle";
  }
  if (ui.addFrameTitle) {
    ui.addFrameTitle.textContent = isEdit ? "Kare Düzenle" : "Yeni Kare Ekle";
  }
  addFrameEditorState.editIndex = isEdit ? editIndex : -1;
  updateAddFrameEditorSliderMeta();

  ui.addFrameModal.hidden = false;
  document.body.classList.add("modal-open");
  addFrameEditorState.open = true;
  ui.addFrameDurationInput?.focus();
}

function updateAddFrameEditorSliderMeta() {
  if (ui.addFrameDurationInput && ui.addFrameDurationVal) {
    const duration = clamp(ui.addFrameDurationInput.value, 40, 1200, 150);
    ui.addFrameDurationInput.value = String(duration);
    ui.addFrameDurationVal.textContent = `${duration} ms`;
  }
  if (ui.addFrameBrightnessInput && ui.addFrameBrightnessVal) {
    const brightness = clamp(ui.addFrameBrightnessInput.value, 0, 15, 8);
    ui.addFrameBrightnessInput.value = String(brightness);
    ui.addFrameBrightnessVal.textContent = String(brightness);
  }
}

function ensureTextPreviewGrid() {
  if (!ui.textPreviewGrid) return;
  if (ui.textPreviewGrid.childElementCount === 64) return;
  ui.textPreviewGrid.innerHTML = "";
  for (let i = 0; i < 64; i++) {
    const dot = document.createElement("span");
    dot.className = "text-preview-dot";
    ui.textPreviewGrid.appendChild(dot);
  }
}

function drawTextPreviewRows(rows) {
  if (!ui.textPreviewGrid) return;
  const dots = ui.textPreviewGrid.querySelectorAll(".text-preview-dot");
  if (dots.length !== 64) return;
  for (let r = 0; r < 8; r++) {
    const row = rows[r] || 0;
    for (let c = 0; c < 8; c++) {
      const on = ((row >> (7 - c)) & 1) === 1;
      dots[r * 8 + c].classList.toggle("on", on);
    }
  }
}

function stopTextPreview(clearGrid = false) {
  if (textPreviewTimer) {
    clearTimeout(textPreviewTimer);
    textPreviewTimer = null;
  }
  textPreviewFrames = [];
  textPreviewIndex = 0;
  if (clearGrid) drawTextPreviewRows(emptyRows8());
}

function stepTextPreview(delayMs) {
  if (!textPreviewFrames.length) return;
  textPreviewTimer = window.setTimeout(() => {
    textPreviewIndex = (textPreviewIndex + 1) % textPreviewFrames.length;
    drawTextPreviewRows(textPreviewFrames[textPreviewIndex].rows);
    stepTextPreview(delayMs);
  }, delayMs);
}

function refreshTextPreview(actions) {
  ensureTextPreviewGrid();
  const txt = ui.textInput.value.trim();
  if (!txt) {
    stopTextPreview(true);
    if (ui.textPreviewHint) ui.textPreviewHint.textContent = "Mesaj yazınca akış burada görünecek.";
    return;
  }

  const frameMs = textLettersPerSecToFrameMs();
  const textBrightness = clamp(ui.textBrightnessInput?.value, 0, 15, 8);
  const result = actions.buildTextScrollFrames(txt, frameMs, state.textDirection === "right", false, textBrightness);
  textPreviewFrames = result.frames;
  textPreviewIndex = 0;

  if (!textPreviewFrames.length) {
    stopTextPreview(true);
    if (ui.textPreviewHint) ui.textPreviewHint.textContent = "Önizleme üretilemedi.";
    return;
  }

  if (textPreviewTimer) {
    clearTimeout(textPreviewTimer);
    textPreviewTimer = null;
  }
  drawTextPreviewRows(textPreviewFrames[0].rows);
  stepTextPreview(frameMs);
  if (ui.textPreviewHint) {
    ui.textPreviewHint.textContent = result.truncated
      ? `Önizleme: ilk ${MAX_FRAMES} kare`
      : `Önizleme: ${textPreviewFrames.length} kare`;
  }
}

function ensureAnimPreviewGrid() {
  if (!ui.animPreviewGrid) return;
  if (ui.animPreviewGrid.childElementCount === 64) return;
  ui.animPreviewGrid.innerHTML = "";
  for (let i = 0; i < 64; i++) {
    const dot = document.createElement("span");
    dot.className = "text-preview-dot";
    ui.animPreviewGrid.appendChild(dot);
  }
}

function drawAnimPreviewRows(rows) {
  if (!ui.animPreviewGrid) return;
  const dots = ui.animPreviewGrid.querySelectorAll(".text-preview-dot");
  if (dots.length !== 64) return;
  for (let r = 0; r < 8; r++) {
    const row = rows[r] || 0;
    for (let c = 0; c < 8; c++) {
      const on = ((row >> (7 - c)) & 1) === 1;
      dots[r * 8 + c].classList.toggle("on", on);
    }
  }
}

function stopAnimPreview(clearGrid = false) {
  if (animPreviewTimer) {
    clearTimeout(animPreviewTimer);
    animPreviewTimer = null;
  }
  animPreviewIndex = 0;
  if (clearGrid) drawAnimPreviewRows(emptyRows8());
}

function stepAnimPreview() {
  if (!state.frames.length || ui.tabAnim?.hidden) return;
  const frame = state.frames[animPreviewIndex];
  if (!frame) return;
  drawAnimPreviewRows(frame.rows || emptyRows8());
  const delay = clamp(frame.duration, 40, 1200, 150);
  const loopEnabled = Number(ui.loopSelect?.value || 0) === 1;
  animPreviewTimer = window.setTimeout(() => {
    if (!state.frames.length || ui.tabAnim?.hidden) return;
    if (animPreviewIndex >= state.frames.length - 1) {
      if (!loopEnabled) {
        if (ui.animPreviewHint) ui.animPreviewHint.textContent = `Önizleme: ${state.frames.length} kare (tek tur)`;
        animPreviewTimer = null;
        return;
      }
      animPreviewIndex = 0;
    } else {
      animPreviewIndex += 1;
    }
    stepAnimPreview();
  }, delay);
}

function refreshAnimPreview() {
  ensureAnimPreviewGrid();
  updateAnimToggleUi();
  if (!ui.animPreviewGrid) return;
  if (ui.tabAnim?.hidden) {
    stopAnimPreview(false);
    return;
  }
  if (!state.frames.length) {
    stopAnimPreview(true);
    if (ui.animPreviewHint) ui.animPreviewHint.textContent = "Önizleme için kare ekle.";
    return;
  }
  stopAnimPreview(false);
  animPreviewIndex = state.selectedFrame >= 0 ? Math.min(state.selectedFrame, state.frames.length - 1) : 0;
  if (ui.animPreviewHint) ui.animPreviewHint.textContent = `Önizleme: ${state.frames.length} kare`;
  stepAnimPreview();
}

export function resetBrightnessSyncState() {
  brightnessPendingValue = null;
  brightnessLastSentValue = null;
  if (brightnessAutoTimer) {
    clearTimeout(brightnessAutoTimer);
    brightnessAutoTimer = null;
  }
}

export function setUiHooks(next) {
  if (next && typeof next.scheduleLivePreview === "function") {
    hooks.scheduleLivePreview = next.scheduleLivePreview;
  }
  if (next && typeof next.renderFrames === "function") {
    hooks.renderFrames = next.renderFrames;
  }
}

export function setStatus(text, connected) {
  ui.connectionMenuBtn.classList.toggle("connected", Boolean(connected));
  ui.connectionLabel.textContent = text || (connected ? "Bağlı" : "Bağlan");
  ui.connectionMenuBtn.title = connected ? "Bağlantıyı kes" : "Bağlan";
  ui.connectionMenuBtn.setAttribute("aria-label", connected ? "Bağlantıyı kes" : "Bağlan");
}

export function setActiveTab(name) {
  const map = {
    draw: ui.tabDraw,
    text: ui.tabText,
    anim: ui.tabAnim,
    device: ui.tabDevice,
  };
  Object.entries(map).forEach(([key, panel]) => {
    panel.hidden = key !== name;
  });
  ui.tabs.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  if (name !== "text") stopTextPreview(false);
  if (name !== "anim") stopAnimPreview(false);
  updateAnimToggleUi();
}

function updateAnimToggleUi() {
  if (!ui.animToggleBtn) return;
  const onAnimTab = !ui.tabAnim?.hidden;
  ui.animToggleBtn.hidden = !onAnimTab;
  const pending = state.frames.length > 0 && state.animationDirty;
  ui.animToggleBtn.classList.toggle("pending-soft", pending);
  if (!onAnimTab) return;

  if (animToggleState === "playing") {
    ui.animToggleIcon?.setAttribute("d", "M7 5h4v14H7zm6 0h4v14h-4z");
    if (ui.animToggleLabel) ui.animToggleLabel.textContent = "Duraklat";
    return;
  }
  ui.animToggleIcon?.setAttribute("d", "M8 5v14l11-7z");
  if (ui.animToggleLabel) {
    ui.animToggleLabel.textContent = animToggleState === "paused" ? "Devam Et" : "Oynat";
  }
}

function setAnimToggleState(next) {
  animToggleState = next;
  updateAnimToggleUi();
}

export function resetAnimToggleState() {
  setAnimToggleState("idle");
}

function updateTextSpeedUi() {
  if (!ui.textSpeedInput || !ui.textSpeedVal) return;
  const lettersPerSec = textLettersPerSec();
  ui.textSpeedVal.textContent = `${lettersPerSec.toFixed(1)} harf/s`;
}

function updateTextBrightnessUi() {
  if (!ui.textBrightnessInput || !ui.textBrightnessVal) return;
  const value = clamp(ui.textBrightnessInput.value, 0, 15, 8);
  ui.textBrightnessInput.value = String(value);
  ui.textBrightnessVal.textContent = String(value);
}

function textLettersPerSec() {
  const raw = clamp(ui.textSpeedInput.value, 5, 600, 90);
  // Eski geniş slider aralığını korurken harf/s değeri üretir: 5 -> 0.1, 600 -> 12.0
  return raw / 50;
}

function textLettersPerSecToFrameMs() {
  const lettersPerSec = textLettersPerSec();
  // 5x7 fontta bir karakter yaklaşık 6 kolon kayar (5 kolon + 1 boşluk).
  const columnsPerSec = lettersPerSec * 6;
  const ms = Math.round(1000 / columnsPerSec);
  return clamp(ms, 30, 2000, 90);
}

export function updateBrightnessUi() {
  const min = Number(ui.brightnessRange.min || 0);
  const max = Number(ui.brightnessRange.max || 15);
  const value = clamp(ui.brightnessRange.value, min, max, 8);
  ui.brightnessFloatVal.textContent = String(value);
  updateSendImageButtonState();
}

function currentDrawSendSignature() {
  const rows = gridToRows();
  const brightness = clamp(ui.brightnessRange.value, 0, 15, 8);
  return `${rowsSignature(rows)}|${brightness}`;
}

function currentTextSendSignature() {
  const text = ui.textInput?.value?.trim() || "";
  if (!text) return "";
  const speedRaw = clamp(ui.textSpeedInput?.value, 5, 600, 90);
  const brightness = clamp(ui.textBrightnessInput?.value, 0, 15, 8);
  return `${text}|${speedRaw}|${brightness}|${state.textDirection}`;
}

function updateSendImageButtonState() {
  if (!ui.sendImgBtn) return;
  const pending = currentDrawSendSignature() !== state.lastSentDrawSignature;
  ui.sendImgBtn.classList.toggle("pending-soft", pending);
}

function markCurrentDrawAsSent() {
  state.lastSentDrawSignature = currentDrawSendSignature();
  updateSendImageButtonState();
}

export function initSendImageButtonState() {
  markCurrentDrawAsSent();
}

function updateTextSendButtonState() {
  if (!ui.txtSendBtn) return;
  const signature = currentTextSendSignature();
  const pending = Boolean(signature) && signature !== state.lastSentTextSignature;
  ui.txtSendBtn.classList.toggle("pending-soft", pending);
}

function markCurrentTextAsSent() {
  state.lastSentTextSignature = currentTextSendSignature();
  updateTextSendButtonState();
}

function scheduleAutoBrightnessSet(actions, immediate = false) {
  const value = clamp(ui.brightnessRange.value, 0, 15, 8);
  brightnessPendingValue = value;

  if (!state.livePreviewEnabled) return;
  if (!state.rx || !state.notifications) return;
  if (brightnessPendingValue === brightnessLastSentValue) return;

  if (brightnessAutoTimer) clearTimeout(brightnessAutoTimer);
  brightnessAutoTimer = window.setTimeout(async () => {
    brightnessAutoTimer = null;
    const v = brightnessPendingValue;
    if (v == null) return;
    if (v === brightnessLastSentValue) return;
    try {
      await actions.sendTextAck(`BRT:${v}`, "OK:BRT");
      brightnessLastSentValue = v;
    } catch (err) {
      log(`Parlaklık hatası: ${err.message}`);
    }
  }, immediate ? 0 : 120);
}

function applyTheme(themeKey, persist = true) {
  const theme = THEMES.find((x) => x.key === themeKey) || THEMES[0];
  state.currentTheme = theme.key;

  const classes = THEMES.filter((x) => x.key !== "rose").map((x) => `theme-${x.key}`);
  document.body.classList.remove(...classes);
  if (theme.key !== "rose") {
    document.body.classList.add(`theme-${theme.key}`);
  }

  ui.themeMeta.textContent = `Tema: ${theme.label}`;
  const themeColor = THEME_CHROME_COLORS[theme.key] || THEME_CHROME_COLORS.rose;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", themeColor);
  }
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme.key);
}

function cycleTheme() {
  const idx = THEMES.findIndex((x) => x.key === state.currentTheme);
  const next = THEMES[(idx + 1 + THEMES.length) % THEMES.length];
  applyTheme(next.key, true);
}

export function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const valid = THEMES.some((x) => x.key === saved) ? saved : "rose";
  applyTheme(valid, false);
}

export function gridToRows() {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let value = 0;
    for (let c = 0; c < 8; c++) {
      if (state.grid[r][c]) value |= (1 << (7 - c));
    }
    rows.push(value);
  }
  return rows;
}

function reverseByte8(v) {
  let x = v & 0xff;
  x = ((x & 0xf0) >> 4) | ((x & 0x0f) << 4);
  x = ((x & 0xcc) >> 2) | ((x & 0x33) << 2);
  x = ((x & 0xaa) >> 1) | ((x & 0x55) << 1);
  return x;
}

export function mirrorRowsForDevice(rows) {
  return rows.map((v) => reverseByte8(v));
}

export function rowsSignature(rows) {
  return rows.map((v) => (v & 0xff).toString(16).toUpperCase().padStart(2, "0")).join("");
}

export function rowsToGrid(rows) {
  for (let r = 0; r < 8; r++) {
    const v = rows[r] || 0;
    for (let c = 0; c < 8; c++) {
      state.grid[r][c] = ((v >> (7 - c)) & 1) === 1;
    }
  }
  renderGrid();
}

export function createGrid() {
  ui.pixelGrid.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "px";
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);

      cell.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        state.drawActive = true;
        state.drawValue = !state.grid[r][c];
        state.grid[r][c] = state.drawValue;
        state.lastPaintedKey = `${r},${c}`;
        ui.pixelGrid.setPointerCapture?.(ev.pointerId);
        renderGrid();
      });

      cell.addEventListener("pointerenter", () => {
        if (!state.drawActive) return;
        state.grid[r][c] = state.drawValue;
        renderGrid();
      });

      ui.pixelGrid.appendChild(cell);
    }
  }

  if (!globalPointerUpBound) {
    window.addEventListener("pointerup", () => {
      state.drawActive = false;
      state.lastPaintedKey = "";
    });
    globalPointerUpBound = true;
  }

  ui.pixelGrid.addEventListener("pointermove", (ev) => {
    if (!state.drawActive) return;
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!(target instanceof HTMLElement) || !target.classList.contains("px")) return;

    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;

    const key = `${r},${c}`;
    if (key === state.lastPaintedKey) return;
    state.lastPaintedKey = key;

    if (state.grid[r][c] !== state.drawValue) {
      state.grid[r][c] = state.drawValue;
      renderGrid();
    }
  });

  ui.pixelGrid.addEventListener("pointerup", () => {
    state.drawActive = false;
    state.lastPaintedKey = "";
  });

  ui.pixelGrid.addEventListener("pointercancel", () => {
    state.drawActive = false;
    state.lastPaintedKey = "";
  });

  renderGrid();
}

export function renderGrid() {
  ui.pixelGrid.querySelectorAll(".px").forEach((cell) => {
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    cell.classList.toggle("on", state.grid[r][c]);
  });
  updateSendImageButtonState();
  hooks.scheduleLivePreview();
}

function rotateCCW() {
  const next = Array.from({ length: 8 }, () => Array(8).fill(false));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      next[7 - c][r] = state.grid[r][c];
    }
  }
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      state.grid[r][c] = next[r][c];
    }
  }
  renderGrid();
}

export function renderStatus(statusText) {
  const parts = statusText.split(";");
  const map = {};
  for (const p of parts) {
    const i = p.indexOf(":");
    if (i <= 0) continue;
    map[p.slice(0, i)] = p.slice(i + 1);
  }

  ui.statusKv.innerHTML = "";
  const order = ["MODE", "BRT", "FRAMES", "LOOP", "PAUSED", "UPLOADING", "UP_EXP", "UP_RX", "TEXT"];
  for (const key of order) {
    if (!(key in map)) continue;
    const item = document.createElement("div");
    item.textContent = `${key}: ${map[key]}`;
    ui.statusKv.appendChild(item);
  }
}

export function bindUi(actions) {
  ui.connectionMenuBtn.addEventListener("click", async () => {
    if (state.device?.gatt?.connected) {
      const ok = window.confirm("Bağlantıyı kesmek istiyor musun?");
      if (!ok) return;
      try {
        state.device.gatt.disconnect();
      } catch (err) {
        log(`Kesme hatası: ${err.message}`);
      }
      return;
    }
    await actions.connectBle();
  });

  ui.tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveTab(btn.dataset.tab);
      if (btn.dataset.tab === "text") refreshTextPreview(actions);
      if (btn.dataset.tab === "anim") refreshAnimPreview();
    });
  });

  ui.clearGridBtn.addEventListener("click", () => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) state.grid[r][c] = false;
    renderGrid();
  });

  ui.fillGridBtn.addEventListener("click", () => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) state.grid[r][c] = true;
    renderGrid();
  });

  ui.invertGridBtn.addEventListener("click", () => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) state.grid[r][c] = !state.grid[r][c];
    renderGrid();
  });

  ui.rotateBtn.addEventListener("click", rotateCCW);

  ui.previewBtn.addEventListener("click", async () => {
    if (!state.livePreviewEnabled) {
      if (!state.rx) {
        log("Canlı önizleme için önce bağlan.");
        return;
      }
      actions.setLivePreview(true);
      scheduleAutoBrightnessSet(actions, true);
      await actions.pushPreviewFrame();
    } else {
      actions.setLivePreview(false);
    }
  });

  if (ui.sendImgBtn) {
    ui.sendImgBtn.addEventListener("click", async () => {
      try {
        if (!state.livePreviewEnabled) {
          const brightness = clamp(ui.brightnessRange.value, 0, 15, 8);
          if (brightness !== brightnessLastSentValue) {
            await actions.sendTextAck(`BRT:${brightness}`, "OK:BRT");
            brightnessLastSentValue = brightness;
          }
        }
        await actions.sendImage(PKT_IMG, "OK:IMG_BIN");
        markCurrentDrawAsSent();
      } catch (err) {
        log(`Göster hatası: ${err.message}`);
      }
    });
  }

  if (ui.addFrameBtn) {
    ui.addFrameBtn.addEventListener("click", () => {
      openAddFrameEditor();
    });
  }

  if (ui.addFrameModal) {
    ui.addFrameModal.addEventListener("click", (ev) => {
      if (ev.target === ui.addFrameModal) {
        closeAddFrameEditor();
      }
    });
  }

  if (ui.addFrameCancelBtn) {
    ui.addFrameCancelBtn.addEventListener("click", () => {
      closeAddFrameEditor();
    });
  }

  if (ui.addFrameSaveBtn) {
    ui.addFrameSaveBtn.addEventListener("click", () => {
      const isEdit = addFrameEditorState.editIndex >= 0;
      if (!isEdit && state.frames.length >= MAX_FRAMES) {
        alert(`Maksimum ${MAX_FRAMES} kare.`);
        return;
      }
      const frame = {
        rows: addFrameEditorToRows(),
        duration: clamp(ui.addFrameDurationInput?.value, 1, 65535, 150),
        brightness: clamp(ui.addFrameBrightnessInput?.value, 0, 15, 8),
      };
      if (isEdit && state.frames[addFrameEditorState.editIndex]) {
        state.frames[addFrameEditorState.editIndex] = frame;
        state.selectedFrame = addFrameEditorState.editIndex;
      } else {
        state.frames.push(frame);
        state.selectedFrame = state.frames.length - 1;
      }
      actions.markAnimationDirty();
      hooks.renderFrames();
      refreshAnimPreview();
      rowsToGrid(frame.rows);
      if (ui.frameDurationInput) ui.frameDurationInput.value = String(frame.duration);
      if (ui.frameBrightnessInput) ui.frameBrightnessInput.value = String(frame.brightness);
      const msg = isEdit
        ? `Kare güncellendi (#${state.selectedFrame + 1}).`
        : `Kare eklendi (#${state.frames.length}).`;
      closeAddFrameEditor();
      log(msg);
    });
  }

  window.addEventListener("lumi:edit-frame", (ev) => {
    const index = Number(ev?.detail?.index);
    if (!Number.isInteger(index) || index < 0 || index >= state.frames.length) return;
    openAddFrameEditor(state.frames[index], index);
  });

  if (ui.addFrameClearBtn) {
    ui.addFrameClearBtn.addEventListener("click", () => {
      addFrameEditorState.grid = Array.from({ length: 8 }, () => Array(8).fill(false));
      renderAddFrameEditorGrid();
    });
  }

  if (ui.addFrameFillBtn) {
    ui.addFrameFillBtn.addEventListener("click", () => {
      addFrameEditorState.grid = Array.from({ length: 8 }, () => Array(8).fill(true));
      renderAddFrameEditorGrid();
    });
  }

  if (ui.addFrameInvertBtn) {
    ui.addFrameInvertBtn.addEventListener("click", () => {
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          addFrameEditorState.grid[r][c] = !addFrameEditorState.grid[r][c];
        }
      }
      renderAddFrameEditorGrid();
    });
  }

  if (ui.addFrameRotateBtn) {
    ui.addFrameRotateBtn.addEventListener("click", () => {
      rotateAddFrameEditorCCW();
      renderAddFrameEditorGrid();
    });
  }

  if (ui.addFrameDurationInput) {
    ui.addFrameDurationInput.addEventListener("input", () => {
      updateAddFrameEditorSliderMeta();
    });
  }

  if (ui.addFrameBrightnessInput) {
    ui.addFrameBrightnessInput.addEventListener("input", () => {
      updateAddFrameEditorSliderMeta();
    });
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !addFrameEditorState.open) return;
    ev.preventDefault();
    closeAddFrameEditor();
  });

  if (ui.updateFrameBtn) {
    ui.updateFrameBtn.addEventListener("click", () => {
      if (state.selectedFrame < 0 || !state.frames[state.selectedFrame]) {
        alert("Önce bir kare sec.");
        return;
      }
      state.frames[state.selectedFrame] = actions.currentDraftFrame();
      actions.markAnimationDirty();
      hooks.renderFrames();
      refreshAnimPreview();
      log(`Kare guncellendi (#${state.selectedFrame + 1}).`);
    });
  }

  ui.deleteFrameBtn.addEventListener("click", () => {
    if (state.selectedFrame < 0) return;
    state.frames.splice(state.selectedFrame, 1);
    state.selectedFrame = state.frames.length ? Math.min(state.selectedFrame, state.frames.length - 1) : -1;
    actions.markAnimationDirty();
    if (state.selectedFrame >= 0) {
      const f = state.frames[state.selectedFrame];
      rowsToGrid(f.rows);
      if (ui.frameDurationInput) ui.frameDurationInput.value = String(f.duration);
      if (ui.frameBrightnessInput) ui.frameBrightnessInput.value = String(f.brightness);
    }
    hooks.renderFrames();
    refreshAnimPreview();
  });

  ui.clearFramesBtn.addEventListener("click", () => {
    state.frames = [];
    state.selectedFrame = -1;
    actions.markAnimationDirty();
    hooks.renderFrames();
    refreshAnimPreview();
    setAnimToggleState("idle");
  });

  ui.loopSelect.addEventListener("change", () => {
    actions.markAnimationDirty();
    refreshAnimPreview();
  });

  ui.brightnessRange.addEventListener("input", () => {
    updateBrightnessUi();
    if (ui.frameBrightnessInput) ui.frameBrightnessInput.value = ui.brightnessRange.value;
    scheduleAutoBrightnessSet(actions, false);
  });

  ui.brightnessRange.addEventListener("change", () => {
    scheduleAutoBrightnessSet(actions, true);
  });

  window.addEventListener("resize", () => updateBrightnessUi());

  ui.themeBtn.addEventListener("click", () => {
    cycleTheme();
  });

  ui.dirLeftBtn.addEventListener("click", () => {
    state.textDirection = "left";
    ui.dirLeftBtn.classList.add("active");
    ui.dirRightBtn.classList.remove("active");
    refreshTextPreview(actions);
    updateTextSendButtonState();
  });

  ui.dirRightBtn.addEventListener("click", () => {
    state.textDirection = "right";
    ui.dirRightBtn.classList.add("active");
    ui.dirLeftBtn.classList.remove("active");
    refreshTextPreview(actions);
    updateTextSendButtonState();
  });

  ui.textInput.addEventListener("input", () => {
    refreshTextPreview(actions);
    updateTextSendButtonState();
  });

  ui.textSpeedInput.addEventListener("input", () => {
    updateTextSpeedUi();
    refreshTextPreview(actions);
    updateTextSendButtonState();
  });

  if (ui.textBrightnessInput) {
    ui.textBrightnessInput.addEventListener("input", () => {
      updateTextBrightnessUi();
      refreshTextPreview(actions);
      updateTextSendButtonState();
    });
  }

  ui.txtSendBtn.addEventListener("click", async () => {
    try {
      const txt = ui.textInput.value.trim();
      if (!txt) return alert("Mesaj yaz.");
      const frameMs = textLettersPerSecToFrameMs();
      const textBrightness = clamp(ui.textBrightnessInput?.value, 0, 15, 8);
      const result = actions.buildTextScrollFrames(txt, frameMs, state.textDirection === "right", false, textBrightness);
      if (!result.frames.length) throw new Error("Yazı karesi üretilemedi.");
      if (result.truncated) {
        alert(`Mesaj uzun olduğu için ilk ${MAX_FRAMES} kare gönderildi.`);
        log(`Yazı kareleri ${MAX_FRAMES} ile sınırlandı.`);
      }
      await actions.uploadFrameSet(result.frames, 1);
      await actions.sendTextAck("PLAY:ANIM", "OK:PLAY_ANIM");
      markCurrentTextAsSent();
      log("Yazı yatay akışta oynatıldı.");
    } catch (err) {
      log(`Yazı hatası: ${err.message}`);
    }
  });

  if (ui.animToggleBtn) {
    ui.animToggleBtn.addEventListener("click", async () => {
      try {
        if (animToggleState === "playing") {
          await actions.sendTextAck("ANIPAUSE", "OK:ANIPAUSE");
          setAnimToggleState("paused");
          return;
        }
        if (animToggleState === "paused") {
          if (state.animationDirty) {
            await actions.smartPlayAnimation();
          } else {
            await actions.sendTextAck("ANIRESUME", "OK:ANIRESUME");
          }
          setAnimToggleState("playing");
          return;
        }
        await actions.smartPlayAnimation();
        setAnimToggleState("playing");
      } catch (err) {
        log(`Anim kontrol hatası: ${err.message}`);
      }
    });
  }

  ui.pingBtn.addEventListener("click", async () => {
    try {
      await actions.sendTextAck("PING", "PONG");
    } catch (err) {
      log(`Ping hatası: ${err.message}`);
    }
  });

  ui.statusBtn.addEventListener("click", async () => {
    try {
      const status = await actions.sendTextAck("STATUS", "MODE:");
      renderStatus(status);
    } catch (err) {
      log(`Durum hatası: ${err.message}`);
    }
  });

  ui.helpBtn.addEventListener("click", async () => {
    try {
      await actions.sendTextAck("HELP", "OK:HELP");
    } catch (err) {
      log(`Help hatası: ${err.message}`);
    }
  });

  ui.clearDeviceBtn.addEventListener("click", async () => {
    try {
      await actions.sendTextAck("CLEAR", "OK:CLEAR");
    } catch (err) {
      log(`Clear hatası: ${err.message}`);
    }
  });

  ui.stopBtn.addEventListener("click", async () => {
    try {
      await actions.sendTextAck("STOP", "OK:STOP");
      setAnimToggleState("idle");
    } catch (err) {
      log(`Stop hatası: ${err.message}`);
    }
  });

  refreshTextPreview(actions);
  refreshAnimPreview();
  updateTextSpeedUi();
  updateTextBrightnessUi();
  updateTextSendButtonState();
  updateAnimToggleUi();
}

export function loadStarterFrames() {
  state.frames = [
    { rows: [0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x18, 0x00], duration: 180, brightness: 8 },
    { rows: [0x66, 0xff, 0xff, 0xff, 0xff, 0x7e, 0x3c, 0x18], duration: 180, brightness: 9 },
  ];
  state.selectedFrame = 0;
  rowsToGrid(state.frames[0].rows);
  if (ui.frameDurationInput) ui.frameDurationInput.value = String(state.frames[0].duration);
  if (ui.frameBrightnessInput) ui.frameBrightnessInput.value = String(state.frames[0].brightness);
  state.animationDirty = true;
  hooks.renderFrames();
  refreshAnimPreview();
}
