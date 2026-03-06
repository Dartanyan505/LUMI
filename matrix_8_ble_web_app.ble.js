import {
  RX_UUID,
  SERVICE_UUID,
  TX_UUID,
  byteHex,
  enqueueBleSend,
  log,
  state,
} from "./matrix_8_ble_web_app.context.js";
import { gridToRows, mirrorRowsForDevice, renderStatus, setStatus } from "./matrix_8_ble_web_app.ui.js";

let onDisconnectedCleanup = () => {};
let txValueTarget = null;

function onTxValueChanged(ev) {
  const msg = new TextDecoder().decode(ev.target.value).trim();
  log(`ESP -> ${msg}`);
  if (msg.startsWith("MODE:")) renderStatus(msg);
  resolveWaiters(msg);
}

export function setOnDisconnectedCleanup(fn) {
  onDisconnectedCleanup = typeof fn === "function" ? fn : () => {};
}

function failWaiters(reason) {
  while (state.waiters.length) {
    const w = state.waiters.pop();
    clearTimeout(w.timer);
    w.reject(new Error(reason));
  }
}

function resolveWaiters(msg) {
  for (let i = state.waiters.length - 1; i >= 0; i--) {
    const w = state.waiters[i];
    if (!w.match(msg)) continue;
    state.waiters.splice(i, 1);
    clearTimeout(w.timer);
    w.resolve(msg);
  }
}

function waitReply(match, timeoutMs = 2600) {
  if (!state.notifications) {
    return {
      promise: Promise.reject(new Error("Bildirim acik degil.")),
      cancel: () => {},
    };
  }
  let waiter = null;
  const promise = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const index = state.waiters.findIndex((w) => w.timer === timer);
      if (index >= 0) state.waiters.splice(index, 1);
      reject(new Error("Yanıt zaman asimi."));
    }, timeoutMs);
    waiter = { match, resolve, reject, timer };
    state.waiters.push(waiter);
  });

  return {
    promise,
    cancel: () => {
      if (!waiter) return;
      const index = state.waiters.indexOf(waiter);
      if (index >= 0) state.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter = null;
    },
  };
}

export async function connectBle() {
  if (!navigator.bluetooth) {
    alert("Bu tarayici Web Bluetooth desteklemiyor.");
    return;
  }
  try {
    const nextDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "LUMI" }],
      optionalServices: [SERVICE_UUID],
    });
    nextDevice.removeEventListener("gattserverdisconnected", onDisconnected);
    nextDevice.addEventListener("gattserverdisconnected", onDisconnected);
    state.device = nextDevice;

    const gatt = await state.device.gatt.connect();
    const service = await gatt.getPrimaryService(SERVICE_UUID);
    state.rx = await service.getCharacteristic(RX_UUID);
    state.tx = await service.getCharacteristic(TX_UUID);

    await state.tx.startNotifications();
    state.notifications = true;

    if (txValueTarget) {
      txValueTarget.removeEventListener("characteristicvaluechanged", onTxValueChanged);
    }
    state.tx.addEventListener("characteristicvaluechanged", onTxValueChanged);
    txValueTarget = state.tx;

    setStatus(`Bağlı: ${state.device.name || "LUMI"}`, true);
    log("Bağlantı kuruldu.");
  } catch (err) {
    log(`Bağlantı hatası: ${err.message}`);
  }
}

function onDisconnected() {
  setStatus("Bağlı Değil", false);
  state.rx = null;
  state.tx = null;
  state.notifications = false;
  if (txValueTarget) {
    txValueTarget.removeEventListener("characteristicvaluechanged", onTxValueChanged);
    txValueTarget = null;
  }
  onDisconnectedCleanup();
  failWaiters("Bağlantı koptu.");
  log("Bağlantı koptu.");
}

async function writeText(command) {
  if (!state.rx) throw new Error("Önce baglan.");
  await state.rx.writeValue(new TextEncoder().encode(command));
  log(`APP -> ${command}`);
}

async function writeBin(bytes) {
  if (!state.rx) throw new Error("Önce baglan.");
  await state.rx.writeValue(bytes);
  log(`APP -> BIN[${Array.from(bytes).map(byteHex).join(" ")}]`);
}

export async function sendTextAck(command, okPrefix, timeoutMs = 2600) {
  return enqueueBleSend(async () => {
    const wait = waitReply((msg) => msg.startsWith(okPrefix) || msg.startsWith("ERR:"), timeoutMs);
    let reply;
    try {
      await writeText(command);
      reply = await wait.promise;
    } catch (err) {
      wait.cancel();
      throw err;
    }
    if (reply.startsWith("ERR:")) throw new Error(reply);
    return reply;
  });
}

export async function sendBinAck(bytes, okPrefix, timeoutMs = 2800) {
  return enqueueBleSend(async () => {
    const wait = waitReply((msg) => msg.startsWith(okPrefix) || msg.startsWith("ERR:"), timeoutMs);
    let reply;
    try {
      await writeBin(bytes);
      reply = await wait.promise;
    } catch (err) {
      wait.cancel();
      throw err;
    }
    if (reply.startsWith("ERR:")) throw new Error(reply);
    return reply;
  });
}

export async function sendImage(type, okPrefix) {
  const bytes = Uint8Array.from([type, ...mirrorRowsForDevice(gridToRows())]);
  await sendBinAck(bytes, okPrefix);
}
