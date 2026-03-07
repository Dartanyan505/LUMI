import { log, ui } from "./matrix_8_ble_web_app.context.js";
import { connectBle, sendImage, sendTextAck, setOnDisconnectedCleanup } from "./matrix_8_ble_web_app.ble.js";
import {
  currentDraftFrame,
  markAnimationDirty,
  pushPreviewFrame,
  renderFrames,
  scheduleLivePreview,
  setLivePreview,
  smartPlayAnimation,
  uploadFrameSet,
} from "./matrix_8_ble_web_app.animation.js";
import { buildTextScrollFrames } from "./matrix_8_ble_web_app.text.js";
import {
  bindUi,
  createGrid,
  initSendImageButtonState,
  initTheme,
  loadStarterFrames,
  resetBrightnessSyncState,
  setActiveTab,
  setUiHooks,
  updateBrightnessUi,
} from "./matrix_8_ble_web_app.ui.js";

setUiHooks({ scheduleLivePreview, renderFrames });
setOnDisconnectedCleanup(() => {
  setLivePreview(false);
  resetBrightnessSyncState();
});

createGrid();
bindUi({
  connectBle,
  sendImage,
  currentDraftFrame,
  markAnimationDirty,
  setLivePreview,
  pushPreviewFrame,
  buildTextScrollFrames,
  uploadFrameSet,
  sendTextAck,
  smartPlayAnimation,
});
initTheme();
ui.dirLeftBtn.classList.add("active");
loadStarterFrames();
updateBrightnessUi();
initSendImageButtonState();
setActiveTab("draw");
log("Hazır. LUMI'den selam.");
