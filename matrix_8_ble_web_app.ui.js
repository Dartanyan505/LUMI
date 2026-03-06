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
}

function scheduleBrightnessFloatHide(delayMs = 650) {
  if (state.brightnessFloatHideTimer) clearTimeout(state.brightnessFloatHideTimer);
  state.brightnessFloatHideTimer = window.setTimeout(() => {
    ui.brightnessFloatVal.classList.remove("show");
    ui.brightnessFloatVal.hidden = true;
  }, delayMs);
}

export function updateBrightnessUi(showFloat = false) {
  const min = Number(ui.brightnessRange.min || 0);
  const max = Number(ui.brightnessRange.max || 15);
  const value = clamp(ui.brightnessRange.value, min, max, 8);
  const percent = max > min ? (value - min) / (max - min) : 0;
  const thumb = 22;
  const usable = Math.max(0, ui.brightnessRange.clientWidth - thumb);
  const x = (thumb / 2) + (usable * percent);

  ui.brightnessFloatVal.textContent = String(value);
  ui.brightnessFloatVal.style.left = `${x}px`;

  if (showFloat) {
    ui.brightnessFloatVal.hidden = false;
    ui.brightnessFloatVal.classList.add("show");
    scheduleBrightnessFloatHide();
  }
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

  window.addEventListener("pointerup", () => {
    state.drawActive = false;
    state.lastPaintedKey = "";
  });

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
      await actions.pushPreviewFrame();
    } else {
      actions.setLivePreview(false);
    }
  });

  ui.sendImgBtn.addEventListener("click", async () => {
    try {
      await actions.sendImage(PKT_IMG, "OK:IMG_BIN");
    } catch (err) {
      log(`Göster hatası: ${err.message}`);
    }
  });

  ui.addFrameBtn.addEventListener("click", () => {
    if (state.frames.length >= MAX_FRAMES) {
      alert(`Maksimum ${MAX_FRAMES} kare.`);
      return;
    }
    state.frames.push(actions.currentDraftFrame());
    state.selectedFrame = state.frames.length - 1;
    actions.markAnimationDirty();
    hooks.renderFrames();
    log(`Kare eklendi (#${state.frames.length}).`);
  });

  ui.updateFrameBtn.addEventListener("click", () => {
    if (state.selectedFrame < 0 || !state.frames[state.selectedFrame]) {
      alert("Önce bir kare sec.");
      return;
    }
    state.frames[state.selectedFrame] = actions.currentDraftFrame();
    actions.markAnimationDirty();
    hooks.renderFrames();
    log(`Kare guncellendi (#${state.selectedFrame + 1}).`);
  });

  ui.deleteFrameBtn.addEventListener("click", () => {
    if (state.selectedFrame < 0) return;
    state.frames.splice(state.selectedFrame, 1);
    state.selectedFrame = state.frames.length ? Math.min(state.selectedFrame, state.frames.length - 1) : -1;
    actions.markAnimationDirty();
    if (state.selectedFrame >= 0) {
      const f = state.frames[state.selectedFrame];
      rowsToGrid(f.rows);
      ui.frameDurationInput.value = String(f.duration);
      ui.frameBrightnessInput.value = String(f.brightness);
    }
    hooks.renderFrames();
  });

  ui.clearFramesBtn.addEventListener("click", () => {
    state.frames = [];
    state.selectedFrame = -1;
    actions.markAnimationDirty();
    hooks.renderFrames();
  });

  ui.loopSelect.addEventListener("change", actions.markAnimationDirty);

  ui.brightnessRange.addEventListener("input", () => {
    updateBrightnessUi(true);
    ui.frameBrightnessInput.value = ui.brightnessRange.value;
  });

  ui.brightnessRange.addEventListener("pointerdown", () => {
    updateBrightnessUi(true);
  });
  ui.brightnessRange.addEventListener("change", () => {
    scheduleBrightnessFloatHide(250);
  });
  ui.brightnessRange.addEventListener("blur", () => {
    scheduleBrightnessFloatHide(120);
  });

  window.addEventListener("resize", () => updateBrightnessUi(false));

  ui.sendBrightnessBtn.addEventListener("click", async () => {
    try {
      const v = clamp(ui.brightnessRange.value, 0, 15, 8);
      await actions.sendTextAck(`BRT:${v}`, "OK:BRT");
    } catch (err) {
      log(`Parlaklık hatası: ${err.message}`);
    }
  });

  ui.themeBtn.addEventListener("click", () => {
    cycleTheme();
  });

  ui.dirLeftBtn.addEventListener("click", () => {
    state.textDirection = "left";
    ui.dirLeftBtn.classList.add("active");
    ui.dirRightBtn.classList.remove("active");
  });

  ui.dirRightBtn.addEventListener("click", () => {
    state.textDirection = "right";
    ui.dirRightBtn.classList.add("active");
    ui.dirLeftBtn.classList.remove("active");
  });

  ui.txtSendBtn.addEventListener("click", async () => {
    try {
      const txt = ui.textInput.value.trim();
      if (!txt) return alert("Mesaj yaz.");
      const speed = clamp(ui.textSpeedInput.value, 1, 65535, 90);
      const result = actions.buildTextScrollFrames(txt, speed, state.textDirection === "right", true);
      if (!result.frames.length) throw new Error("Yazı karesi üretilemedi.");
      if (result.truncated) {
        alert(`Mesaj uzun olduğu için ilk ${MAX_FRAMES} kare gönderildi.`);
        log(`Yazı kareleri ${MAX_FRAMES} ile sınırlandı.`);
      }
      await actions.uploadFrameSet(result.frames, 1);
      await actions.sendTextAck("PLAY:ANIM", "OK:PLAY_ANIM");
      log("Yazı 90° çevrilip oynatildi.");
    } catch (err) {
      log(`Yazı hatası: ${err.message}`);
    }
  });

  ui.playAnimBtn.addEventListener("click", async () => {
    try {
      await actions.smartPlayAnimation();
    } catch (err) {
      log(`Play hatası: ${err.message}`);
    }
  });

  ui.aniPauseBtn.addEventListener("click", async () => {
    try {
      await actions.sendTextAck("ANIPAUSE", "OK:ANIPAUSE");
    } catch (err) {
      log(`Pause hatası: ${err.message}`);
    }
  });

  ui.aniResumeBtn.addEventListener("click", async () => {
    try {
      await actions.sendTextAck("ANIRESUME", "OK:ANIRESUME");
    } catch (err) {
      log(`Resume hatası: ${err.message}`);
    }
  });

  ui.aniStopBtn.addEventListener("click", async () => {
    try {
      await actions.sendTextAck("ANISTOP", "OK:ANISTOP");
    } catch (err) {
      log(`Stop anim hatası: ${err.message}`);
    }
  });

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
    } catch (err) {
      log(`Stop hatası: ${err.message}`);
    }
  });
}

export function loadStarterFrames() {
  state.frames = [
    { rows: [0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x18, 0x00], duration: 180, brightness: 8 },
    { rows: [0x66, 0xff, 0xff, 0xff, 0xff, 0x7e, 0x3c, 0x18], duration: 180, brightness: 9 },
  ];
  state.selectedFrame = 0;
  rowsToGrid(state.frames[0].rows);
  ui.frameDurationInput.value = String(state.frames[0].duration);
  ui.frameBrightnessInput.value = String(state.frames[0].brightness);
  state.animationDirty = true;
  hooks.renderFrames();
}
