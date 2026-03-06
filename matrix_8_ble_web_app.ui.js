    const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
    const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

    const PKT_IMG = 0x01;
    const PKT_PREVIEW = 0x02;
    const PKT_ANIM_BEGIN = 0x10;
    const PKT_ANIM_CHUNK = 0x11;
    const PKT_ANIM_END = 0x12;
    const MAX_FRAMES = 256;
    const UPLOAD_CHUNK_FRAMES = 1;

    let device = null;
    let rx = null;
    let tx = null;
    let notifications = false;

    const grid = Array.from({ length: 8 }, () => Array(8).fill(false));
    let drawActive = false;
    let drawValue = true;
    let lastPaintedKey = "";

    let frames = [];
    let selectedFrame = -1;
    let textDirection = "left";
    let livePreviewEnabled = false;
    let livePreviewTimer = null;
    let lastLivePreviewSignature = "";

    let animationDirty = true;
    let lastUploadedSignature = "";
    let brightnessFloatHideTimer = null;
    const THEME_STORAGE_KEY = "lumi_theme";
    const THEMES = [
      { key: "rose", label: "Pembe" },
      { key: "sky", label: "Mavi" },
      { key: "mint", label: "Mint" },
      { key: "sunset", label: "Gün Batımı" }
    ];
    let currentTheme = "rose";

    const waiters = [];
    let bleSendQueue = Promise.resolve();

    function enqueueBleSend(task) {
      const run = bleSendQueue.catch(() => {}).then(task);
      bleSendQueue = run.catch(() => {});
      return run;
    }

    const ui = {
      connectionMenuBtn: document.getElementById("connectionMenuBtn"),
      connectionLabel: document.getElementById("connectionLabel"),

      tabs: document.querySelectorAll(".tab-btn"),
      tabDraw: document.getElementById("tab-draw"),
      tabText: document.getElementById("tab-text"),
      tabAnim: document.getElementById("tab-anim"),
      tabDevice: document.getElementById("tab-device"),

      pixelGrid: document.getElementById("pixelGrid"),
      clearGridBtn: document.getElementById("clearGridBtn"),
      fillGridBtn: document.getElementById("fillGridBtn"),
      invertGridBtn: document.getElementById("invertGridBtn"),
      rotateBtn: document.getElementById("rotateBtn"),
      previewBtn: document.getElementById("previewBtn"),
      previewBtnLabel: document.getElementById("previewBtnLabel"),
      sendImgBtn: document.getElementById("sendImgBtn"),
      addFrameBtn: document.getElementById("addFrameBtn"),

      brightnessRange: document.getElementById("brightnessRange"),
      brightnessFloatVal: document.getElementById("brightnessFloatVal"),
      sendBrightnessBtn: document.getElementById("sendBrightnessBtn"),
      themeBtn: document.getElementById("themeBtn"),
      themeMeta: document.getElementById("themeMeta"),

      textInput: document.getElementById("textInput"),
      textSpeedInput: document.getElementById("textSpeedInput"),
      dirLeftBtn: document.getElementById("dirLeftBtn"),
      dirRightBtn: document.getElementById("dirRightBtn"),
      txtSendBtn: document.getElementById("txtSendBtn"),

      frameDurationInput: document.getElementById("frameDurationInput"),
      frameBrightnessInput: document.getElementById("frameBrightnessInput"),
      loopSelect: document.getElementById("loopSelect"),
      updateFrameBtn: document.getElementById("updateFrameBtn"),
      deleteFrameBtn: document.getElementById("deleteFrameBtn"),
      clearFramesBtn: document.getElementById("clearFramesBtn"),
      playAnimBtn: document.getElementById("playAnimBtn"),
      aniPauseBtn: document.getElementById("aniPauseBtn"),
      aniResumeBtn: document.getElementById("aniResumeBtn"),
      aniStopBtn: document.getElementById("aniStopBtn"),

      frameInfo: document.getElementById("frameInfo"),
      frames: document.getElementById("frames"),

      pingBtn: document.getElementById("pingBtn"),
      statusBtn: document.getElementById("statusBtn"),
      helpBtn: document.getElementById("helpBtn"),
      clearDeviceBtn: document.getElementById("clearDeviceBtn"),
      stopBtn: document.getElementById("stopBtn"),
      statusKv: document.getElementById("statusKv"),
      log: document.getElementById("log")
    };

    function log(line) {
      const t = new Date().toLocaleTimeString();
      ui.log.textContent += `[${t}] ${line}\n`;
      if (ui.log.textContent.length > 20000) {
        ui.log.textContent = ui.log.textContent.slice(-16000);
      }
      ui.log.scrollTop = ui.log.scrollHeight;
    }

    function clamp(value, min, max, fallback) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.trunc(n)));
    }

    function byteHex(n) {
      return (n & 0xff).toString(16).toUpperCase().padStart(2, "0");
    }

    function setStatus(text, connected) {
      ui.connectionMenuBtn.classList.toggle("connected", Boolean(connected));
      ui.connectionLabel.textContent = connected ? "Bağlı" : "Bağlan";
      ui.connectionMenuBtn.title = connected ? "Bağlantıyı kes" : "Bağlan";
      ui.connectionMenuBtn.setAttribute("aria-label", connected ? "Bağlantıyı kes" : "Bağlan");
    }

    function setActiveTab(name) {
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
      if (brightnessFloatHideTimer) clearTimeout(brightnessFloatHideTimer);
      brightnessFloatHideTimer = window.setTimeout(() => {
        ui.brightnessFloatVal.classList.remove("show");
        ui.brightnessFloatVal.hidden = true;
      }, delayMs);
    }

    function updateBrightnessUi(showFloat = false) {
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
      currentTheme = theme.key;

      const classes = THEMES.filter((x) => x.key !== "rose").map((x) => `theme-${x.key}`);
      document.body.classList.remove(...classes);
      if (theme.key !== "rose") {
        document.body.classList.add(`theme-${theme.key}`);
      }

      ui.themeMeta.textContent = `Tema: ${theme.label}`;
      if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme.key);
    }

    function cycleTheme() {
      const idx = THEMES.findIndex((x) => x.key === currentTheme);
      const next = THEMES[(idx + 1 + THEMES.length) % THEMES.length];
      applyTheme(next.key, true);
    }

    function initTheme() {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      const valid = THEMES.some((x) => x.key === saved) ? saved : "rose";
      applyTheme(valid, false);
    }

    function gridToRows() {
      const rows = [];
      for (let r = 0; r < 8; r++) {
        let value = 0;
        for (let c = 0; c < 8; c++) {
          if (grid[r][c]) value |= (1 << (7 - c));
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

    function mirrorRowsForDevice(rows) {
      return rows.map((v) => reverseByte8(v));
    }

    function rowsSignature(rows) {
      return rows.map(byteHex).join("");
    }

    function rowsToGrid(rows) {
      for (let r = 0; r < 8; r++) {
        const v = rows[r] || 0;
        for (let c = 0; c < 8; c++) {
          grid[r][c] = ((v >> (7 - c)) & 1) === 1;
        }
      }
      renderGrid();
    }

    function createGrid() {
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
            drawActive = true;
            drawValue = !grid[r][c];
            grid[r][c] = drawValue;
            lastPaintedKey = `${r},${c}`;
            ui.pixelGrid.setPointerCapture?.(ev.pointerId);
            renderGrid();
          });

          cell.addEventListener("pointerenter", () => {
            if (!drawActive) return;
            grid[r][c] = drawValue;
            renderGrid();
          });

          ui.pixelGrid.appendChild(cell);
        }
      }

      window.addEventListener("pointerup", () => {
        drawActive = false;
        lastPaintedKey = "";
      });

      ui.pixelGrid.addEventListener("pointermove", (ev) => {
        if (!drawActive) return;
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!(target instanceof HTMLElement) || !target.classList.contains("px")) return;

        const r = Number(target.dataset.r);
        const c = Number(target.dataset.c);
        if (!Number.isInteger(r) || !Number.isInteger(c)) return;

        const key = `${r},${c}`;
        if (key === lastPaintedKey) return;
        lastPaintedKey = key;

        if (grid[r][c] !== drawValue) {
          grid[r][c] = drawValue;
          renderGrid();
        }
      });

      ui.pixelGrid.addEventListener("pointerup", () => {
        drawActive = false;
        lastPaintedKey = "";
      });

      ui.pixelGrid.addEventListener("pointercancel", () => {
        drawActive = false;
        lastPaintedKey = "";
      });

      renderGrid();
    }

    function renderGrid() {
      ui.pixelGrid.querySelectorAll(".px").forEach((cell) => {
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        cell.classList.toggle("on", grid[r][c]);
      });
      scheduleLivePreview();
    }

    function rotateCCW() {
      const next = Array.from({ length: 8 }, () => Array(8).fill(false));
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          next[7 - c][r] = grid[r][c];
        }
      }
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          grid[r][c] = next[r][c];
        }
      }
      renderGrid();
    }

    function renderStatus(statusText) {
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

    function bindUi() {
      ui.connectionMenuBtn.addEventListener("click", async () => {
        if (device?.gatt?.connected) {
          const ok = window.confirm("Bağlantıyı kesmek istiyor musun?");
          if (!ok) return;
          try {
            device.gatt.disconnect();
          } catch (err) {
            log(`Kesme hatası: ${err.message}`);
          }
          return;
        }
        await connectBle();
      });

      ui.tabs.forEach((btn) => {
        btn.addEventListener("click", () => {
          setActiveTab(btn.dataset.tab);
        });
      });

      ui.clearGridBtn.addEventListener("click", () => {
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) grid[r][c] = false;
        renderGrid();
      });

      ui.fillGridBtn.addEventListener("click", () => {
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) grid[r][c] = true;
        renderGrid();
      });

      ui.invertGridBtn.addEventListener("click", () => {
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) grid[r][c] = !grid[r][c];
        renderGrid();
      });

      ui.rotateBtn.addEventListener("click", rotateCCW);

      ui.previewBtn.addEventListener("click", async () => {
        if (!livePreviewEnabled) {
          if (!rx) {
            log("Canlı önizleme için önce bağlan.");
            return;
          }
          setLivePreview(true);
          await pushPreviewFrame();
        } else {
          setLivePreview(false);
        }
      });

      ui.sendImgBtn.addEventListener("click", async () => {
        try {
          await sendImage(PKT_IMG, "OK:IMG_BIN");
        } catch (err) {
          log(`Göster hatası: ${err.message}`);
        }
      });

      ui.addFrameBtn.addEventListener("click", () => {
        if (frames.length >= MAX_FRAMES) {
          alert(`Maksimum ${MAX_FRAMES} kare.`);
          return;
        }
        frames.push(currentDraftFrame());
        selectedFrame = frames.length - 1;
        markAnimationDirty();
        renderFrames();
        log(`Kare eklendi (#${frames.length}).`);
      });

      ui.updateFrameBtn.addEventListener("click", () => {
        if (selectedFrame < 0 || !frames[selectedFrame]) {
          alert("Önce bir kare sec.");
          return;
        }
        frames[selectedFrame] = currentDraftFrame();
        markAnimationDirty();
        renderFrames();
        log(`Kare guncellendi (#${selectedFrame + 1}).`);
      });

      ui.deleteFrameBtn.addEventListener("click", () => {
        if (selectedFrame < 0) return;
        frames.splice(selectedFrame, 1);
        selectedFrame = frames.length ? Math.min(selectedFrame, frames.length - 1) : -1;
        markAnimationDirty();
        if (selectedFrame >= 0) {
          const f = frames[selectedFrame];
          rowsToGrid(f.rows);
          ui.frameDurationInput.value = String(f.duration);
          ui.frameBrightnessInput.value = String(f.brightness);
        }
        renderFrames();
      });

      ui.clearFramesBtn.addEventListener("click", () => {
        frames = [];
        selectedFrame = -1;
        markAnimationDirty();
        renderFrames();
      });

      ui.loopSelect.addEventListener("change", markAnimationDirty);

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
          await sendTextAck(`BRT:${v}`, "OK:BRT");
        } catch (err) {
          log(`Parlaklık hatası: ${err.message}`);
        }
      });

      ui.themeBtn.addEventListener("click", () => {
        cycleTheme();
      });

      ui.dirLeftBtn.addEventListener("click", () => {
        textDirection = "left";
        ui.dirLeftBtn.classList.add("active");
        ui.dirRightBtn.classList.remove("active");
      });

      ui.dirRightBtn.addEventListener("click", () => {
        textDirection = "right";
        ui.dirRightBtn.classList.add("active");
        ui.dirLeftBtn.classList.remove("active");
      });

      ui.txtSendBtn.addEventListener("click", async () => {
        try {
          const txt = ui.textInput.value.trim();
          if (!txt) return alert("Mesaj yaz.");
          const speed = clamp(ui.textSpeedInput.value, 1, 65535, 90);
          const generated = buildTextScrollFrames(txt, speed, textDirection === "right", true);
          if (!generated.length) throw new Error("Yazı karesi üretilemedi.");
          await uploadFrameSet(generated, 1);
          await sendTextAck("PLAY:ANIM", "OK:PLAY_ANIM");
          log("Yazı 90° çevrilip oynatildi.");
        } catch (err) {
          log(`Yazı hatası: ${err.message}`);
        }
      });

      ui.playAnimBtn.addEventListener("click", async () => {
        try {
          await smartPlayAnimation();
        } catch (err) {
          log(`Play hatası: ${err.message}`);
        }
      });

      ui.aniPauseBtn.addEventListener("click", async () => {
        try {
          await sendTextAck("ANIPAUSE", "OK:ANIPAUSE");
        } catch (err) {
          log(`Pause hatası: ${err.message}`);
        }
      });

      ui.aniResumeBtn.addEventListener("click", async () => {
        try {
          await sendTextAck("ANIRESUME", "OK:ANIRESUME");
        } catch (err) {
          log(`Resume hatası: ${err.message}`);
        }
      });

      ui.aniStopBtn.addEventListener("click", async () => {
        try {
          await sendTextAck("ANISTOP", "OK:ANISTOP");
        } catch (err) {
          log(`Stop anim hatası: ${err.message}`);
        }
      });

      ui.pingBtn.addEventListener("click", async () => {
        try {
          await sendTextAck("PING", "PONG");
        } catch (err) {
          log(`Ping hatası: ${err.message}`);
        }
      });

      ui.statusBtn.addEventListener("click", async () => {
        try {
          const status = await sendTextAck("STATUS", "MODE:");
          renderStatus(status);
        } catch (err) {
          log(`Durum hatası: ${err.message}`);
        }
      });

      ui.helpBtn.addEventListener("click", async () => {
        try {
          await sendTextAck("HELP", "OK:HELP");
        } catch (err) {
          log(`Help hatası: ${err.message}`);
        }
      });

      ui.clearDeviceBtn.addEventListener("click", async () => {
        try {
          await sendTextAck("CLEAR", "OK:CLEAR");
        } catch (err) {
          log(`Clear hatası: ${err.message}`);
        }
      });

      ui.stopBtn.addEventListener("click", async () => {
        try {
          await sendTextAck("STOP", "OK:STOP");
        } catch (err) {
          log(`Stop hatası: ${err.message}`);
        }
      });
    }

    function loadStarterFrames() {
      frames = [
        { rows: [0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x18, 0x00], duration: 180, brightness: 8 },
        { rows: [0x66, 0xff, 0xff, 0xff, 0xff, 0x7e, 0x3c, 0x18], duration: 180, brightness: 9 },
      ];
      selectedFrame = 0;
      rowsToGrid(frames[0].rows);
      ui.frameDurationInput.value = String(frames[0].duration);
      ui.frameBrightnessInput.value = String(frames[0].brightness);
      animationDirty = true;
      renderFrames();
    }

