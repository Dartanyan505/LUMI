import {
  MAX_FRAMES,
  PKT_ANIM_BEGIN,
  PKT_ANIM_CHUNK,
  PKT_ANIM_END,
  PKT_PREVIEW,
  UPLOAD_CHUNK_FRAMES,
  clamp,
  enqueueBleSend,
  log,
  state,
  ui,
} from "./matrix_8_ble_web_app.context.js";
import { gridToRows, mirrorRowsForDevice, rowsSignature, rowsToGrid } from "./matrix_8_ble_web_app.ui.js";
import { sendBinAck, sendTextAck } from "./matrix_8_ble_web_app.ble.js";

export function currentDraftFrame() {
  return {
    rows: gridToRows(),
    duration: clamp(ui.frameDurationInput.value, 1, 65535, 150),
    brightness: clamp(ui.frameBrightnessInput.value, 0, 15, 8),
  };
}

export function markAnimationDirty() {
  state.animationDirty = true;
}

export function setLivePreview(enabled) {
  state.livePreviewEnabled = enabled;
  ui.previewBtn.classList.toggle("active", enabled);
  ui.previewBtnLabel.textContent = enabled ? "Canlı Önizleme Açık" : "Canlı Önizleme";
  if (!enabled) {
    state.lastLivePreviewSignature = "";
    if (state.livePreviewTimer) {
      clearTimeout(state.livePreviewTimer);
      state.livePreviewTimer = null;
    }
  }
}

export async function pushPreviewFrame() {
  if (!state.livePreviewEnabled || !state.rx) return;
  const rows = gridToRows();
  const signature = rowsSignature(rows);
  if (signature === state.lastLivePreviewSignature) return;
  state.lastLivePreviewSignature = signature;
  try {
    await enqueueBleSend(async () => {
      if (!state.rx) throw new Error("Önce baglan.");
      const deviceRows = mirrorRowsForDevice(rows);
      await state.rx.writeValue(Uint8Array.from([PKT_PREVIEW, ...deviceRows]));
    });
  } catch (err) {
    log(`Canlı önizleme hatası: ${err.message}`);
    setLivePreview(false);
  }
}

export function scheduleLivePreview() {
  if (!state.livePreviewEnabled || !state.rx) return;
  if (state.livePreviewTimer) return;
  state.livePreviewTimer = window.setTimeout(async () => {
    state.livePreviewTimer = null;
    await pushPreviewFrame();
  }, 45);
}

function animationSignature() {
  return JSON.stringify({
    loop: Number(ui.loopSelect.value) ? 1 : 0,
    frames: state.frames,
  });
}

export function renderFrames() {
  ui.frames.innerHTML = "";
  state.frames.forEach((frame, idx) => {
    const card = document.createElement("div");
    card.className = `frame ${idx === state.selectedFrame ? "active" : ""}`;
    card.addEventListener("click", () => {
      state.selectedFrame = idx;
      rowsToGrid(frame.rows);
      ui.frameDurationInput.value = String(frame.duration);
      ui.frameBrightnessInput.value = String(frame.brightness);
      renderFrames();
    });

    const mini = document.createElement("div");
    mini.className = "mini";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const dot = document.createElement("span");
        if (((frame.rows[r] >> (7 - c)) & 1) === 1) dot.classList.add("on");
        mini.appendChild(dot);
      }
    }

    const meta = document.createElement("div");
    meta.className = "small";
    meta.textContent = `#${idx + 1} ${frame.duration}ms B${frame.brightness}`;

    card.appendChild(mini);
    card.appendChild(meta);
    ui.frames.appendChild(card);
  });

  ui.frameInfo.textContent = `${state.frames.length} kare` + (state.selectedFrame >= 0 ? `, seçili: #${state.selectedFrame + 1}` : "");
}

export async function uploadFrameSet(frameSet, loopValue) {
  if (!frameSet.length) throw new Error("Gönderilecek kare yok.");
  if (frameSet.length > MAX_FRAMES) throw new Error(`Maksimum ${MAX_FRAMES} kare.`);

  const begin = Uint8Array.from([
    PKT_ANIM_BEGIN,
    frameSet.length & 0xff,
    (frameSet.length >> 8) & 0xff,
    loopValue ? 1 : 0,
    0x00,
  ]);
  await sendBinAck(begin, "OK:BEGIN");

  const chunks = chunkFrames(frameSet, UPLOAD_CHUNK_FRAMES);
  for (const chunk of chunks) {
    const body = [
      PKT_ANIM_CHUNK,
      chunk.start & 0xff,
      (chunk.start >> 8) & 0xff,
      chunk.data.length,
    ];

    for (const frame of chunk.data) {
      const deviceRows = mirrorRowsForDevice(frame.rows);
      body.push(frame.duration & 0xff, (frame.duration >> 8) & 0xff, frame.brightness & 0xff, ...deviceRows);
    }

    await sendBinAck(Uint8Array.from(body), "OK:CHUNK", 3200);
  }

  await sendBinAck(Uint8Array.from([PKT_ANIM_END]), "OK:END");
}

function chunkFrames(list, chunkSize) {
  const chunks = [];
  for (let i = 0; i < list.length; i += chunkSize) {
    chunks.push({ start: i, data: list.slice(i, i + chunkSize) });
  }
  return chunks;
}

async function uploadAnimationIfNeeded(force = false) {
  if (!state.frames.length) throw new Error("Animasyon icin en az bir kare ekle.");
  if (state.frames.length > MAX_FRAMES) throw new Error(`Maksimum ${MAX_FRAMES} kare.`);

  const signature = animationSignature();
  if (!force && !state.animationDirty && signature === state.lastUploadedSignature) {
    return false;
  }

  const loop = Number(ui.loopSelect.value) ? 1 : 0;
  await uploadFrameSet(state.frames, loop);

  state.lastUploadedSignature = signature;
  state.animationDirty = false;
  return true;
}

export async function smartPlayAnimation() {
  const uploaded = await uploadAnimationIfNeeded(false);
  if (uploaded) {
    log("Animasyon guncellendi.");
  }
  await sendTextAck("PLAY:ANIM", "OK:PLAY_ANIM");
}
