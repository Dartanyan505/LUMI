export const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export const PKT_IMG = 0x01;
export const PKT_PREVIEW = 0x02;
export const PKT_ANIM_BEGIN = 0x10;
export const PKT_ANIM_CHUNK = 0x11;
export const PKT_ANIM_END = 0x12;

export const MAX_FRAMES = 256;
export const UPLOAD_CHUNK_FRAMES = 1;

export const THEME_STORAGE_KEY = "lumi_theme";
export const THEMES = [
  { key: "rose", label: "Pembe" },
  { key: "sky", label: "Mavi" },
  { key: "mint", label: "Mint" },
  { key: "sunset", label: "Gün Batımı" },
];

export const state = {
  device: null,
  rx: null,
  tx: null,
  notifications: false,

  grid: Array.from({ length: 8 }, () => Array(8).fill(false)),
  drawActive: false,
  drawValue: true,
  lastPaintedKey: "",

  frames: [],
  selectedFrame: -1,
  textDirection: "left",
  livePreviewEnabled: false,
  livePreviewTimer: null,
  lastLivePreviewSignature: "",

  animationDirty: true,
  lastUploadedSignature: "",
  brightnessFloatHideTimer: null,
  currentTheme: "rose",

  waiters: [],
  bleSendQueue: Promise.resolve(),
};

export const ui = {
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
  log: document.getElementById("log"),
};

export function enqueueBleSend(task) {
  const run = state.bleSendQueue.catch(() => {}).then(task);
  state.bleSendQueue = run.catch(() => {});
  return run;
}

export function log(line) {
  const t = new Date().toLocaleTimeString();
  ui.log.textContent += `[${t}] ${line}\n`;
  if (ui.log.textContent.length > 20000) {
    ui.log.textContent = ui.log.textContent.slice(-16000);
  }
  ui.log.scrollTop = ui.log.scrollHeight;
}

export function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function byteHex(n) {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, "0");
}
