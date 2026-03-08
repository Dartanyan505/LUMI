import {
  ANIM_PRESETS_STORAGE_KEY,
  DRAW_PRESETS_STORAGE_KEY,
  MAX_FRAMES,
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
let boundActions = null;
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
const drawCells = Array.from({ length: 8 }, () => Array(8).fill(null));
const addFrameEditorCells = Array.from({ length: 8 }, () => Array(8).fill(null));
const drawPresetEditorCells = Array.from({ length: 8 }, () => Array(8).fill(null));
const addFrameEditorState = {
  grid: Array.from({ length: 8 }, () => Array(8).fill(false)),
  drawActive: false,
  drawValue: true,
  lastPaintedKey: "",
  open: false,
  editIndex: -1,
};
const drawPresetEditorState = {
  grid: Array.from({ length: 8 }, () => Array(8).fill(false)),
  drawActive: false,
  drawValue: true,
  lastPaintedKey: "",
};
const MAX_LOCAL_PRESETS = 64;
const DRAW_PRESETS_REMOTE_URL = "../presets/draw_presets.json";
const ANIM_PRESETS_REMOTE_URL = "../presets/anim_presets.json";
let drawPresetSelectedName = "";
let remoteDrawPresets = [];
let remoteAnimPresets = [];
let remoteDrawPresetsPromise = null;
let remoteAnimPresetsPromise = null;
let drawPresetEditorName = "";
let drawPresetEditorOpen = false;
let drawPresetEditorCreateMode = false;
let animPresetSelectedName = "";
let animPresetEditorName = "";
let animPresetEditorOpen = false;
let animPresetPreviewTimer = null;
let animPresetPreviewCards = [];
let createAnimModalOpen = false;
let createAnimModalResolve = null;

function readPresetStore(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePresetStore(storageKey, presets) {
  const safe = Array.isArray(presets) ? presets.slice(0, MAX_LOCAL_PRESETS) : [];
  localStorage.setItem(storageKey, JSON.stringify(safe));
}

function askPresetName(actionLabel, presets) {
  const existing = presets.map((x) => String(x?.name || "").trim()).filter(Boolean);
  const hint = existing.length ? `\nKayıtlar: ${existing.join(", ")}` : "";
  const raw = window.prompt(`${actionLabel} için isim gir.${hint}`);
  const name = String(raw || "").trim();
  return name;
}

function upsertPresetByName(storageKey, name, data) {
  const presets = readPresetStore(storageKey);
  const next = presets.filter((x) => String(x?.name || "").trim() !== name);
  next.unshift({ name, ...data, savedAt: Date.now() });
  writePresetStore(storageKey, next);
}

function pickPresetByName(storageKey, actionLabel) {
  const presets = readPresetStore(storageKey);
  if (!presets.length) {
    alert("Kayıt bulunamadı.");
    return null;
  }
  const name = askPresetName(actionLabel, presets);
  if (!name) return null;
  const found = presets.find((x) => String(x?.name || "").trim() === name);
  if (!found) {
    alert(`"${name}" bulunamadı.`);
    return null;
  }
  return found;
}

function pickPresetFromList(presets, actionLabel) {
  if (!presets.length) {
    alert("Kayıt bulunamadı.");
    return null;
  }
  const name = askPresetName(actionLabel, presets);
  if (!name) return null;
  const found = presets.find((x) => String(x?.name || "").trim() === name);
  if (!found) {
    alert(`"${name}" bulunamadı.`);
    return null;
  }
  return found;
}

function normalizePresetName(name) {
  return String(name || "").trim();
}

function parsePresetPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.presets)) return raw.presets;
  return [];
}

async function fetchRemotePresetArray(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return parsePresetPayload(json);
}

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
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = addFrameEditorCells[r][c];
      if (!cell) continue;
      cell.classList.toggle("on", addFrameEditorState.grid[r][c]);
    }
  }
}

function renderAddFrameEditorCell(r, c) {
  const cell = addFrameEditorCells[r][c];
  if (!cell) return;
  cell.classList.toggle("on", addFrameEditorState.grid[r][c]);
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
      addFrameEditorCells[r][c] = cell;

      cell.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        addFrameEditorState.drawActive = true;
        addFrameEditorState.drawValue = !addFrameEditorState.grid[r][c];
        addFrameEditorState.grid[r][c] = addFrameEditorState.drawValue;
        addFrameEditorState.lastPaintedKey = `${r},${c}`;
        ui.addFrameGrid.setPointerCapture?.(ev.pointerId);
        renderAddFrameEditorCell(r, c);
      });

      cell.addEventListener("pointerenter", () => {
        if (!addFrameEditorState.drawActive) return;
        if (addFrameEditorState.grid[r][c] === addFrameEditorState.drawValue) return;
        addFrameEditorState.grid[r][c] = addFrameEditorState.drawValue;
        renderAddFrameEditorCell(r, c);
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
      renderAddFrameEditorCell(r, c);
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

function closeDrawPresetEditor() {
  if (!ui.drawPresetModal) return;
  ui.drawPresetModal.hidden = true;
  document.body.classList.remove("modal-open");
  drawPresetEditorState.drawActive = false;
  drawPresetEditorState.lastPaintedKey = "";
  drawPresetEditorName = "";
  drawPresetEditorCreateMode = false;
  drawPresetEditorOpen = false;
}

function rowsToDrawPresetEditor(rows) {
  for (let r = 0; r < 8; r++) {
    const row = rows[r] || 0;
    for (let c = 0; c < 8; c++) {
      drawPresetEditorState.grid[r][c] = ((row >> (7 - c)) & 1) === 1;
    }
  }
}

function drawPresetEditorToRows() {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = 0;
    for (let c = 0; c < 8; c++) {
      if (drawPresetEditorState.grid[r][c]) row |= (1 << (7 - c));
    }
    rows.push(row);
  }
  return rows;
}

function rotateDrawPresetEditorCCW() {
  const next = Array.from({ length: 8 }, () => Array(8).fill(false));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      next[7 - c][r] = drawPresetEditorState.grid[r][c];
    }
  }
  drawPresetEditorState.grid = next;
}

function renderDrawPresetEditorGrid() {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = drawPresetEditorCells[r][c];
      if (!cell) continue;
      cell.classList.toggle("on", drawPresetEditorState.grid[r][c]);
    }
  }
}

function renderDrawPresetEditorCell(r, c) {
  const cell = drawPresetEditorCells[r][c];
  if (!cell) return;
  cell.classList.toggle("on", drawPresetEditorState.grid[r][c]);
}

function createDrawPresetEditorGrid() {
  if (!ui.drawPresetGrid) return;
  if (ui.drawPresetGrid.childElementCount === 64) return;

  ui.drawPresetGrid.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "px";
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      drawPresetEditorCells[r][c] = cell;

      cell.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        drawPresetEditorState.drawActive = true;
        drawPresetEditorState.drawValue = !drawPresetEditorState.grid[r][c];
        drawPresetEditorState.grid[r][c] = drawPresetEditorState.drawValue;
        drawPresetEditorState.lastPaintedKey = `${r},${c}`;
        ui.drawPresetGrid.setPointerCapture?.(ev.pointerId);
        renderDrawPresetEditorCell(r, c);
      });

      cell.addEventListener("pointerenter", () => {
        if (!drawPresetEditorState.drawActive) return;
        if (drawPresetEditorState.grid[r][c] === drawPresetEditorState.drawValue) return;
        drawPresetEditorState.grid[r][c] = drawPresetEditorState.drawValue;
        renderDrawPresetEditorCell(r, c);
      });

      ui.drawPresetGrid.appendChild(cell);
    }
  }

  ui.drawPresetGrid.addEventListener("pointermove", (ev) => {
    if (!drawPresetEditorState.drawActive) return;
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!(target instanceof HTMLElement) || !target.classList.contains("px")) return;

    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;

    const key = `${r},${c}`;
    if (key === drawPresetEditorState.lastPaintedKey) return;
    drawPresetEditorState.lastPaintedKey = key;

    if (drawPresetEditorState.grid[r][c] !== drawPresetEditorState.drawValue) {
      drawPresetEditorState.grid[r][c] = drawPresetEditorState.drawValue;
      renderDrawPresetEditorCell(r, c);
    }
  });

  ui.drawPresetGrid.addEventListener("pointerup", () => {
    drawPresetEditorState.drawActive = false;
    drawPresetEditorState.lastPaintedKey = "";
  });

  ui.drawPresetGrid.addEventListener("pointercancel", () => {
    drawPresetEditorState.drawActive = false;
    drawPresetEditorState.lastPaintedKey = "";
  });

  window.addEventListener("pointerup", () => {
    drawPresetEditorState.drawActive = false;
    drawPresetEditorState.lastPaintedKey = "";
  });
}

function openDrawPresetEditor(name) {
  const preset = drawPresetList().find((item) => item.name === name);
  if (!preset || preset.source !== "local" || !ui.drawPresetModal) return;
  drawPresetEditorCreateMode = false;
  createDrawPresetEditorGrid();
  rowsToDrawPresetEditor(preset.rows || emptyRows8());
  renderDrawPresetEditorGrid();
  drawPresetEditorName = preset.name;
  drawPresetEditorOpen = true;
  if (ui.drawPresetModalTitle) ui.drawPresetModalTitle.textContent = preset.name;
  if (ui.drawPresetModalDeleteBtn) ui.drawPresetModalDeleteBtn.hidden = false;
  if (ui.drawPresetModalSaveBtn) {
    const label = ui.drawPresetModalSaveBtn.querySelector("span");
    if (label) label.textContent = "Kaydet";
  }
  ui.drawPresetModal.hidden = false;
  document.body.classList.add("modal-open");
  ui.drawPresetModalTitle?.focus();
}

function openCreateDrawPresetEditor() {
  if (!ui.drawPresetModal) return;
  drawPresetEditorCreateMode = true;
  drawPresetEditorName = "";
  drawPresetEditorOpen = true;
  createDrawPresetEditorGrid();
  rowsToDrawPresetEditor(emptyRows8());
  renderDrawPresetEditorGrid();
  if (ui.drawPresetModalTitle) ui.drawPresetModalTitle.textContent = "Yeni Çizim";
  if (ui.drawPresetModalDeleteBtn) ui.drawPresetModalDeleteBtn.hidden = true;
  if (ui.drawPresetModalSaveBtn) {
    const label = ui.drawPresetModalSaveBtn.querySelector("span");
    if (label) label.textContent = "Oluştur";
  }
  ui.drawPresetModal.hidden = false;
  document.body.classList.add("modal-open");
  ui.drawPresetModalTitle?.focus();
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
    // Seçili bir animasyon yoksa ilk kareyi boş başlat.
    const seedRows = state.frames.length ? gridToRows() : emptyRows8();
    rowsToAddFrameEditor(seedRows);
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

function clearAnimationWorkspace() {
  state.frames = [];
  state.selectedFrame = -1;
  animPresetSelectedName = "";
  state.activeAnimationName = "";
  state.activeAnimationCanAddFrames = false;
  rowsToGrid(emptyRows8());
  if (boundActions?.markAnimationDirty) {
    boundActions.markAnimationDirty();
  } else {
    state.animationDirty = true;
  }
  hooks.renderFrames();
  refreshAnimPreview();
  setAnimToggleState("idle");
  renderAnimationPresets();
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
    return;
  }

  const frameMs = textLettersPerSecToFrameMs();
  const textBrightness = clamp(ui.textBrightnessInput?.value, 0, 15, 8);
  const result = actions.buildTextScrollFrames(txt, frameMs, state.textDirection === "right", false, textBrightness);
  textPreviewFrames = result.frames;
  textPreviewIndex = 0;

  if (!textPreviewFrames.length) {
    stopTextPreview(true);
    return;
  }

  if (textPreviewTimer) {
    clearTimeout(textPreviewTimer);
    textPreviewTimer = null;
  }
  drawTextPreviewRows(textPreviewFrames[0].rows);
  stepTextPreview(frameMs);
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
  animPreviewTimer = window.setTimeout(() => {
    if (!state.frames.length || ui.tabAnim?.hidden) return;
    if (animPreviewIndex >= state.frames.length - 1) {
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
}

function currentTextSendSignature() {
  const text = ui.textInput?.value?.trim() || "";
  if (!text) return "";
  const speedRaw = clamp(ui.textSpeedInput?.value, 5, 600, 90);
  const brightness = clamp(ui.textBrightnessInput?.value, 0, 15, 8);
  return `${text}|${speedRaw}|${brightness}|${state.textDirection}`;
}

export function initSendImageButtonState() {
  // Göster butonu artık yalnızca canlı gösterim toggle durumu taşır.
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

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return emptyRows8();
  return Array.from({ length: 8 }, (_, i) => clamp(rows[i], 0, 255, 0));
}

function sanitizeFrame(frame) {
  return {
    rows: sanitizeRows(frame?.rows),
    duration: clamp(frame?.duration, 1, 65535, 150),
    brightness: clamp(frame?.brightness, 0, 15, 8),
  };
}

function localDrawPresetList() {
  const presets = readPresetStore(DRAW_PRESETS_STORAGE_KEY);
  return presets
    .map((item) => ({
      name: normalizePresetName(item?.name),
      rows: sanitizeRows(item?.rows),
      savedAt: Number(item?.savedAt) || 0,
      source: "local",
    }))
    .filter((item) => Boolean(item.name));
}

function serverDrawPresetList() {
  return remoteDrawPresets
    .map((item) => ({
      name: normalizePresetName(item?.name),
      rows: sanitizeRows(item?.rows),
      savedAt: Number(item?.savedAt) || 0,
      source: "server",
    }))
    .filter((item) => Boolean(item.name));
}

function drawPresetList() {
  const local = localDrawPresetList();
  const remote = serverDrawPresetList();
  const out = remote.slice();
  const indexByName = new Map(out.map((item, idx) => [item.name, idx]));
  for (const item of local) {
    const idx = indexByName.get(item.name);
    if (idx == null) {
      out.push(item);
    } else {
      out[idx] = item;
    }
  }
  return out;
}

function localAnimationPresetList() {
  const presets = readPresetStore(ANIM_PRESETS_STORAGE_KEY);
  return presets
    .map((item) => ({
      name: normalizePresetName(item?.name),
      loop: Number(item?.loop) ? 1 : 0,
      frames: Array.isArray(item?.frames) ? item.frames.map((f) => sanitizeFrame(f)) : [],
      savedAt: Number(item?.savedAt) || 0,
      source: "local",
    }))
    .filter((item) => Boolean(item.name));
}

function serverAnimationPresetList() {
  return remoteAnimPresets
    .map((item) => ({
      name: normalizePresetName(item?.name),
      loop: Number(item?.loop) ? 1 : 0,
      frames: Array.isArray(item?.frames) ? item.frames.map((f) => sanitizeFrame(f)) : [],
      savedAt: Number(item?.savedAt) || 0,
      source: "server",
    }))
    .filter((item) => Boolean(item.name));
}

function animationPresetList() {
  const local = localAnimationPresetList();
  const remote = serverAnimationPresetList();
  const out = remote.slice();
  const indexByName = new Map(out.map((item, idx) => [item.name, idx]));
  for (const item of local) {
    const idx = indexByName.get(item.name);
    if (idx == null) {
      out.push(item);
    } else {
      out[idx] = item;
    }
  }
  return out;
}

function isRemoteAnimationName(name) {
  const n = normalizePresetName(name);
  return serverAnimationPresetList().some((item) => item.name === n);
}

async function ensureRemoteDrawPresets() {
  if (remoteDrawPresetsPromise) return remoteDrawPresetsPromise;
  remoteDrawPresetsPromise = (async () => {
    try {
      remoteDrawPresets = await fetchRemotePresetArray(DRAW_PRESETS_REMOTE_URL);
    } catch {
      remoteDrawPresets = [];
    } finally {
      remoteDrawPresetsPromise = null;
    }
  })();
  return remoteDrawPresetsPromise;
}

async function ensureRemoteAnimPresets() {
  if (remoteAnimPresetsPromise) return remoteAnimPresetsPromise;
  remoteAnimPresetsPromise = (async () => {
    try {
      remoteAnimPresets = await fetchRemotePresetArray(ANIM_PRESETS_REMOTE_URL);
    } catch {
      remoteAnimPresets = [];
    } finally {
      remoteAnimPresetsPromise = null;
    }
  })();
  return remoteAnimPresetsPromise;
}

async function loadRemotePresets() {
  await Promise.all([ensureRemoteDrawPresets(), ensureRemoteAnimPresets()]);
  renderDrawPresets();
  renderAnimationPresets();
}

function renderMiniRows(host, rows) {
  const mini = document.createElement("div");
  mini.className = "mini";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const dot = document.createElement("span");
      if (((rows[r] >> (7 - c)) & 1) === 1) dot.classList.add("on");
      mini.appendChild(dot);
    }
  }
  host.appendChild(mini);
}

function drawMiniRowsToDots(dots, rows) {
  for (let r = 0; r < 8; r++) {
    const row = rows[r] || 0;
    for (let c = 0; c < 8; c++) {
      const on = ((row >> (7 - c)) & 1) === 1;
      dots[r * 8 + c].classList.toggle("on", on);
    }
  }
}

function stopAnimationPresetMiniPreview() {
  if (animPresetPreviewTimer) {
    clearInterval(animPresetPreviewTimer);
    animPresetPreviewTimer = null;
  }
  animPresetPreviewCards = [];
}

function startAnimationPresetMiniPreview() {
  stopAnimationPresetMiniPreview();
  const animated = animPresetPreviewCards.filter((item) => item.frames.length > 1);
  if (!animated.length) return;
  animPresetPreviewTimer = window.setInterval(() => {
    for (const item of animated) {
      item.index = (item.index + 1) % item.frames.length;
      drawMiniRowsToDots(item.dots, item.frames[item.index].rows);
    }
  }, 140);
}

function loadDrawPresetByName(name) {
  const found = drawPresetList().find((item) => item.name === name);
  if (!found) return;
  rowsToGrid(found.rows);
  drawPresetSelectedName = found.name;
  renderDrawPresets();
  log(`Çizim yüklendi: ${found.name}`);
}

function deleteDrawPresetByName(name) {
  const target = drawPresetList().find((item) => item.name === name);
  if (!target) return;
  if (target.source === "server") {
    alert("Sunucu kaydı silinemez.");
    return;
  }
  const next = localDrawPresetList().filter((item) => item.name !== name);
  writePresetStore(DRAW_PRESETS_STORAGE_KEY, next);
  if (drawPresetSelectedName === name) drawPresetSelectedName = "";
  if (drawPresetEditorName === name) closeDrawPresetEditor();
  renderDrawPresets();
  log(`Çizim silindi: ${name}`);
}

function saveDrawPresetEditor() {
  const nextName = normalizePresetName(ui.drawPresetModalTitle?.textContent);
  if (!nextName) {
    alert("Ad boş olamaz.");
    ui.drawPresetModalTitle?.focus();
    return;
  }

  if (drawPresetEditorCreateMode) {
    const exists = drawPresetList().some((item) => item.name === nextName);
    if (exists) {
      alert("Bu adda kayıt zaten var.");
      ui.drawPresetModalTitle?.focus();
      return;
    }
    const created = {
      name: nextName,
      rows: drawPresetEditorToRows(),
      savedAt: Date.now(),
    };
    const next = localDrawPresetList().filter((item) => item.name !== nextName);
    next.push(created);
    writePresetStore(DRAW_PRESETS_STORAGE_KEY, next);
    drawPresetSelectedName = created.name;
    rowsToGrid(created.rows);
    renderDrawPresets();
    closeDrawPresetEditor();
    log(`Çizim oluşturuldu: ${created.name}`);
    return;
  }

  if (!drawPresetEditorName) return;

  const local = localDrawPresetList();
  const idx = local.findIndex((item) => item.name === drawPresetEditorName);
  if (idx < 0) return;
  const exists = drawPresetList().some((item) => item.name === nextName && item.name !== drawPresetEditorName);
  if (exists) {
    alert("Bu adda kayıt zaten var.");
    ui.drawPresetModalTitle?.focus();
    return;
  }

  const updated = {
    ...local[idx],
    name: nextName,
    rows: drawPresetEditorToRows(),
    savedAt: Date.now(),
  };
  local[idx] = updated;
  writePresetStore(DRAW_PRESETS_STORAGE_KEY, local);

  drawPresetEditorName = nextName;
  drawPresetSelectedName = updated.name;
  rowsToGrid(updated.rows);
  renderDrawPresets();
  closeDrawPresetEditor();
  log(`Çizim güncellendi: ${updated.name}`);
}

function renderDrawPresets() {
  if (!ui.drawPresets || !ui.drawPresetInfo) return;
  const presets = drawPresetList();
  ui.drawPresets.innerHTML = "";
  ui.drawPresetInfo.textContent = presets.length
    ? `${presets.length} çizim kaydı`
    : "Henüz kayıt yok.";

  presets.forEach((preset) => {
    const card = document.createElement("div");
    card.className = `frame ${preset.name === drawPresetSelectedName ? "active" : ""}`;
    card.addEventListener("click", () => {
      loadDrawPresetByName(preset.name);
    });

    if (preset.source === "local") {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "frame-edit-btn";
      editBtn.title = "Kaydı düzenle";
      editBtn.setAttribute("aria-label", "Kaydı düzenle");
      editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 19h14v2H5zM14.7 5.3l4 4L10 18H6v-4z"/></svg>';
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openDrawPresetEditor(preset.name);
      });
      card.appendChild(editBtn);
    }

    renderMiniRows(card, preset.rows);

    const meta = document.createElement("div");
    meta.className = "small draw-preset-name";
    meta.textContent = preset.name;
    card.appendChild(meta);

    ui.drawPresets.appendChild(card);
  });

  const addCard = document.createElement("button");
  addCard.type = "button";
  addCard.className = "draw-add-btn";
  addCard.setAttribute("aria-label", "Yeni Çizim Ekle");
  addCard.title = "Yeni Çizim Ekle";
  addCard.textContent = "+";
  addCard.addEventListener("click", () => {
    openCreateDrawPresetEditor();
  });
  ui.drawPresets.appendChild(addCard);
}

function applyAnimationPreset(preset) {
  const frames = Array.isArray(preset?.frames) ? preset.frames.map((f) => sanitizeFrame(f)) : [];
  state.frames = frames.slice(0, MAX_FRAMES);
  state.selectedFrame = state.frames.length ? 0 : -1;

  if (state.selectedFrame >= 0) {
    const f = state.frames[0];
    rowsToGrid(f.rows);
    if (ui.frameDurationInput) ui.frameDurationInput.value = String(f.duration);
    if (ui.frameBrightnessInput) ui.frameBrightnessInput.value = String(f.brightness);
  } else {
    rowsToGrid(emptyRows8());
  }

  if (boundActions?.markAnimationDirty) {
    boundActions.markAnimationDirty();
  } else {
    state.animationDirty = true;
  }
  hooks.renderFrames();
  refreshAnimPreview();
  setAnimToggleState("idle");
}

function loadAnimationPresetByName(name) {
  if (animPresetSelectedName === name) {
    clearAnimationWorkspace();
    log("Animasyon seçimi kaldırıldı.");
    return;
  }
  const found = animationPresetList().find((item) => item.name === name);
  if (!found) return;
  animPresetSelectedName = found.name;
  state.activeAnimationName = found.name;
  state.activeAnimationCanAddFrames = found.source === "local" && !isRemoteAnimationName(found.name);
  applyAnimationPreset(found);
  renderAnimationPresets();
  log(`Animasyon yüklendi: ${found.name}`);
}

function createEmptyAnimationByName(name) {
  const payload = {
    name,
    loop: 1,
    frames: [],
    savedAt: Date.now(),
  };
  const next = localAnimationPresetList().filter((item) => item.name !== name);
  next.push(payload);
  writePresetStore(ANIM_PRESETS_STORAGE_KEY, next);
  animPresetSelectedName = name;
  state.activeAnimationName = name;
  state.activeAnimationCanAddFrames = true;
  applyAnimationPreset(payload);
  renderAnimationPresets();
  log(`Animasyon oluşturuldu: ${name}`);
}

function persistActiveAnimationFrames() {
  if (!state.activeAnimationCanAddFrames || !state.activeAnimationName) return;
  const local = localAnimationPresetList();
  const idx = local.findIndex((item) => item.name === state.activeAnimationName);
  if (idx < 0) return;
  local[idx] = {
    ...local[idx],
    loop: 1,
    frames: state.frames.map((f) => sanitizeFrame(f)),
    savedAt: Date.now(),
  };
  writePresetStore(ANIM_PRESETS_STORAGE_KEY, local);
}

function closeCreateAnimationModal(resultName = "") {
  if (!ui.createAnimModal) return;
  ui.createAnimModal.hidden = true;
  document.body.classList.remove("modal-open");
  createAnimModalOpen = false;
  if (ui.createAnimNameError) ui.createAnimNameError.textContent = "";
  const resolve = createAnimModalResolve;
  createAnimModalResolve = null;
  if (resolve) resolve(resultName);
}

function submitCreateAnimationModal() {
  const name = normalizePresetName(ui.createAnimNameInput?.value);
  if (!name) {
    if (ui.createAnimNameError) ui.createAnimNameError.textContent = "Animasyon adı gir.";
    ui.createAnimNameInput?.focus();
    return;
  }
  const exists = animationPresetList().some((item) => item.name === name);
  if (exists) {
    if (ui.createAnimNameError) ui.createAnimNameError.textContent = "Bu adda bir animasyon zaten var.";
    ui.createAnimNameInput?.focus();
    ui.createAnimNameInput?.select();
    return;
  }
  closeCreateAnimationModal(name);
}

function openCreateAnimationModal() {
  if (!ui.createAnimModal || !ui.createAnimNameInput) return Promise.resolve("");
  if (createAnimModalResolve) {
    createAnimModalResolve("");
    createAnimModalResolve = null;
  }
  ui.createAnimNameInput.value = "";
  if (ui.createAnimNameError) ui.createAnimNameError.textContent = "";
  ui.createAnimModal.hidden = false;
  document.body.classList.add("modal-open");
  createAnimModalOpen = true;
  window.setTimeout(() => ui.createAnimNameInput?.focus(), 0);

  return new Promise((resolve) => {
    createAnimModalResolve = resolve;
  });
}

async function createAnimationFromModal() {
  const name = await openCreateAnimationModal();
  if (!name) return false;
  createEmptyAnimationByName(name);
  return true;
}

function deleteAnimationPresetByName(name) {
  const target = animationPresetList().find((item) => item.name === name);
  if (!target) return;
  if (target.source === "server" || isRemoteAnimationName(name)) {
    alert("Sunucu kaydı silinemez.");
    return;
  }
  const next = localAnimationPresetList().filter((item) => item.name !== name);
  writePresetStore(ANIM_PRESETS_STORAGE_KEY, next);
  if (animPresetSelectedName === name) {
    animPresetSelectedName = "";
    state.activeAnimationName = "";
    state.activeAnimationCanAddFrames = false;
  }
  if (animPresetEditorName === name) closeAnimationPresetEditor();
  renderAnimationPresets();
  log(`Animasyon silindi: ${name}`);
}

function closeAnimationPresetEditor() {
  if (!ui.animPresetModal) return;
  ui.animPresetModal.hidden = true;
  document.body.classList.remove("modal-open");
  animPresetEditorName = "";
  animPresetEditorOpen = false;
}

function openAnimationPresetEditor(name) {
  const preset = animationPresetList().find((item) => item.name === name);
  if (!preset || preset.source !== "local" || isRemoteAnimationName(name) || !ui.animPresetModal) return;
  animPresetEditorName = preset.name;
  animPresetEditorOpen = true;
  if (ui.animPresetModalTitle) ui.animPresetModalTitle.textContent = preset.name;
  if (ui.animPresetModalMeta) {
    ui.animPresetModalMeta.textContent = `${preset.frames.length} kare · Loop Açık`;
  }
  ui.animPresetModal.hidden = false;
  document.body.classList.add("modal-open");
}

function saveAnimationPresetEditor() {
  if (!animPresetEditorName) return;
  const nextName = normalizePresetName(ui.animPresetModalTitle?.textContent);
  if (!nextName) {
    alert("Ad boş olamaz.");
    ui.animPresetModalTitle?.focus();
    return;
  }
  const exists = animationPresetList().some((item) => item.name === nextName && item.name !== animPresetEditorName);
  if (exists) {
    alert("Bu adda kayıt zaten var.");
    ui.animPresetModalTitle?.focus();
    return;
  }
  if (!state.frames.length) {
    alert("Kaydetmek için en az bir kare ekle.");
    return;
  }

  const local = localAnimationPresetList();
  const idx = local.findIndex((item) => item.name === animPresetEditorName);
  if (idx < 0) return;
  if (isRemoteAnimationName(animPresetEditorName)) {
    alert("Sunucu kaydı düzenlenemez.");
    return;
  }

  const updated = {
    ...local[idx],
    name: nextName,
    loop: 1,
    frames: state.frames.map((f) => sanitizeFrame(f)),
    savedAt: Date.now(),
  };
  local[idx] = updated;
  writePresetStore(ANIM_PRESETS_STORAGE_KEY, local);

  animPresetEditorName = nextName;
  animPresetSelectedName = nextName;
  state.activeAnimationName = nextName;
  renderAnimationPresets();
  closeAnimationPresetEditor();
  log(`Animasyon güncellendi: ${nextName}`);
}

function renderAnimationPresets() {
  if (!ui.animPresets || !ui.animPresetInfo) return;
  stopAnimationPresetMiniPreview();
  const presets = animationPresetList();
  ui.animPresets.innerHTML = "";
  ui.animPresetInfo.textContent = presets.length
    ? `${presets.length} animasyon kaydı`
    : "Henüz kayıt yok.";

  presets.forEach((preset) => {
    const card = document.createElement("div");
    card.className = `frame ${preset.name === animPresetSelectedName ? "active" : ""}`;
    card.addEventListener("click", () => {
      loadAnimationPresetByName(preset.name);
    });

    if (preset.source === "local" && !isRemoteAnimationName(preset.name)) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "frame-edit-btn";
      editBtn.title = "Kaydı düzenle";
      editBtn.setAttribute("aria-label", "Kaydı düzenle");
      editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 19h14v2H5zM14.7 5.3l4 4L10 18H6v-4z"/></svg>';
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openAnimationPresetEditor(preset.name);
      });
      card.appendChild(editBtn);
    }

    const mini = document.createElement("div");
    mini.className = "mini";
    const dots = [];
    for (let i = 0; i < 64; i++) {
      const dot = document.createElement("span");
      mini.appendChild(dot);
      dots.push(dot);
    }
    const frames = Array.isArray(preset.frames) && preset.frames.length
      ? preset.frames.map((f) => ({ rows: sanitizeRows(f.rows) }))
      : [{ rows: emptyRows8() }];
    drawMiniRowsToDots(dots, frames[0].rows);
    card.appendChild(mini);
    animPresetPreviewCards.push({ dots, frames, index: 0 });

    const meta = document.createElement("div");
    meta.className = "small draw-preset-name";
    meta.textContent = preset.name;
    card.appendChild(meta);

    ui.animPresets.appendChild(card);
  });

  const addCard = document.createElement("button");
  addCard.type = "button";
  addCard.className = "draw-add-btn";
  addCard.setAttribute("aria-label", "Animasyon Oluştur");
  addCard.title = "Animasyon Oluştur";
  addCard.textContent = "+";
  addCard.addEventListener("click", () => {
    void createAnimationFromModal();
  });
  ui.animPresets.appendChild(addCard);
  startAnimationPresetMiniPreview();
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
      drawCells[r][c] = cell;

      cell.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        state.drawActive = true;
        state.drawValue = !state.grid[r][c];
        state.grid[r][c] = state.drawValue;
        state.lastPaintedKey = `${r},${c}`;
        ui.pixelGrid.setPointerCapture?.(ev.pointerId);
        renderGridCell(r, c);
        afterGridMutation();
      });

      cell.addEventListener("pointerenter", () => {
        if (!state.drawActive) return;
        if (state.grid[r][c] === state.drawValue) return;
        state.grid[r][c] = state.drawValue;
        renderGridCell(r, c);
        afterGridMutation();
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
      renderGridCell(r, c);
      afterGridMutation();
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

function renderGridCell(r, c) {
  const cell = drawCells[r][c];
  if (!cell) return;
  cell.classList.toggle("on", state.grid[r][c]);
}

function afterGridMutation() {
  hooks.scheduleLivePreview();
}

export function renderGrid() {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      renderGridCell(r, c);
    }
  }
  afterGridMutation();
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
  boundActions = actions;
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

  if (ui.sendImgBtn) {
    ui.sendImgBtn.addEventListener("click", async () => {
      try {
        if (!state.livePreviewEnabled) {
          if (!state.rx) {
            log("Göster için önce bağlan.");
            return;
          }
          actions.setLivePreview(true);
          scheduleAutoBrightnessSet(actions, true);
          await actions.pushPreviewFrame();
          return;
        }
        actions.setLivePreview(false);
      } catch (err) {
        log(`Canlı gösterim hatası: ${err.message}`);
      }
    });
  }

  if (ui.drawPresetModal) {
    ui.drawPresetModal.addEventListener("click", (ev) => {
      if (ev.target === ui.drawPresetModal) {
        closeDrawPresetEditor();
      }
    });
  }
  if (ui.drawPresetModalCloseBtn) {
    ui.drawPresetModalCloseBtn.addEventListener("click", () => {
      closeDrawPresetEditor();
    });
  }
  if (ui.drawPresetRenameBtn) {
    ui.drawPresetRenameBtn.addEventListener("click", () => {
      if (!drawPresetEditorName && !drawPresetEditorCreateMode) return;
      if (!ui.drawPresetModalTitle) return;
      ui.drawPresetModalTitle.focus();
      const range = document.createRange();
      range.selectNodeContents(ui.drawPresetModalTitle);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }
  if (ui.drawPresetModalTitle) {
    ui.drawPresetModalTitle.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      ui.drawPresetModalSaveBtn?.focus();
    });
  }
  if (ui.drawPresetModalDeleteBtn) {
    ui.drawPresetModalDeleteBtn.addEventListener("click", () => {
      if (!drawPresetEditorName) return;
      deleteDrawPresetByName(drawPresetEditorName);
      closeDrawPresetEditor();
    });
  }
  if (ui.drawPresetModalSaveBtn) {
    ui.drawPresetModalSaveBtn.addEventListener("click", () => {
      saveDrawPresetEditor();
    });
  }
  if (ui.drawPresetClearBtn) {
    ui.drawPresetClearBtn.addEventListener("click", () => {
      drawPresetEditorState.grid = Array.from({ length: 8 }, () => Array(8).fill(false));
      renderDrawPresetEditorGrid();
    });
  }
  if (ui.drawPresetFillBtn) {
    ui.drawPresetFillBtn.addEventListener("click", () => {
      drawPresetEditorState.grid = Array.from({ length: 8 }, () => Array(8).fill(true));
      renderDrawPresetEditorGrid();
    });
  }
  if (ui.drawPresetInvertBtn) {
    ui.drawPresetInvertBtn.addEventListener("click", () => {
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          drawPresetEditorState.grid[r][c] = !drawPresetEditorState.grid[r][c];
        }
      }
      renderDrawPresetEditorGrid();
    });
  }
  if (ui.drawPresetRotateBtn) {
    ui.drawPresetRotateBtn.addEventListener("click", () => {
      rotateDrawPresetEditorCCW();
      renderDrawPresetEditorGrid();
    });
  }
  if (ui.animPresetModal) {
    ui.animPresetModal.addEventListener("click", (ev) => {
      if (ev.target === ui.animPresetModal) {
        closeAnimationPresetEditor();
      }
    });
  }
  if (ui.animPresetModalCloseBtn) {
    ui.animPresetModalCloseBtn.addEventListener("click", () => {
      closeAnimationPresetEditor();
    });
  }
  if (ui.animPresetRenameBtn) {
    ui.animPresetRenameBtn.addEventListener("click", () => {
      if (!animPresetEditorName || !ui.animPresetModalTitle) return;
      ui.animPresetModalTitle.focus();
      const range = document.createRange();
      range.selectNodeContents(ui.animPresetModalTitle);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }
  if (ui.animPresetModalTitle) {
    ui.animPresetModalTitle.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      ui.animPresetModalSaveBtn?.focus();
    });
  }
  if (ui.animPresetModalDeleteBtn) {
    ui.animPresetModalDeleteBtn.addEventListener("click", () => {
      if (!animPresetEditorName) return;
      deleteAnimationPresetByName(animPresetEditorName);
      closeAnimationPresetEditor();
    });
  }
  if (ui.animPresetModalSaveBtn) {
    ui.animPresetModalSaveBtn.addEventListener("click", () => {
      saveAnimationPresetEditor();
    });
  }

  if (ui.createAnimModal) {
    ui.createAnimModal.addEventListener("click", (ev) => {
      if (ev.target === ui.createAnimModal) {
        closeCreateAnimationModal("");
      }
    });
  }
  if (ui.createAnimCancelBtn) {
    ui.createAnimCancelBtn.addEventListener("click", () => {
      closeCreateAnimationModal("");
    });
  }
  if (ui.createAnimCreateBtn) {
    ui.createAnimCreateBtn.addEventListener("click", () => {
      submitCreateAnimationModal();
    });
  }
  if (ui.createAnimNameInput) {
    ui.createAnimNameInput.addEventListener("input", () => {
      if (ui.createAnimNameError) ui.createAnimNameError.textContent = "";
    });
    ui.createAnimNameInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submitCreateAnimationModal();
      }
    });
  }

  window.addEventListener("lumi:add-frame", () => {
    if (!state.activeAnimationName || !state.activeAnimationCanAddFrames) return;
    openAddFrameEditor();
  });

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
      persistActiveAnimationFrames();
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
    if (!state.activeAnimationCanAddFrames) return;
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
    if (ev.key !== "Escape") return;
    if (drawPresetEditorOpen) {
      ev.preventDefault();
      closeDrawPresetEditor();
      return;
    }
    if (animPresetEditorOpen) {
      ev.preventDefault();
      closeAnimationPresetEditor();
      return;
    }
    if (createAnimModalOpen) {
      ev.preventDefault();
      closeCreateAnimationModal("");
      return;
    }
    if (!addFrameEditorState.open) return;
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
    persistActiveAnimationFrames();
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
    persistActiveAnimationFrames();
    actions.markAnimationDirty();
    hooks.renderFrames();
    refreshAnimPreview();
    setAnimToggleState("idle");
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
      await actions.sendTextAck(`BRT:${textBrightness}`, "OK:BRT");
      const command = state.textDirection === "right"
        ? `TXT_R:${frameMs},${txt}`
        : `TXT:${frameMs},${txt}`;
      const okPrefix = state.textDirection === "right" ? "OK:TXT_R" : "OK:TXT";
      await actions.sendTextAck(command, okPrefix, 4200);
      markCurrentTextAsSent();
      log("Yazı doğrudan cihazda oynatıldı.");
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
  renderDrawPresets();
  renderAnimationPresets();
  void loadRemotePresets();
  updateTextSpeedUi();
  updateTextBrightnessUi();
  updateTextSendButtonState();
  updateAnimToggleUi();
}

export function loadStarterFrames() {
  state.frames = [];
  state.selectedFrame = -1;
  rowsToGrid(emptyRows8());
  if (ui.frameDurationInput) ui.frameDurationInput.value = "150";
  if (ui.frameBrightnessInput) ui.frameBrightnessInput.value = "8";
  state.animationDirty = true;
  hooks.renderFrames();
  refreshAnimPreview();
}
