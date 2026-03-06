    function failWaiters(reason) {
      while (waiters.length) {
        const w = waiters.pop();
        clearTimeout(w.timer);
        w.reject(new Error(reason));
      }
    }

    function resolveWaiters(msg) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (!w.match(msg)) continue;
        waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }

    function waitReply(match, timeoutMs = 2600) {
      if (!notifications) {
        return Promise.reject(new Error("Bildirim acik degil."));
      }
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          const index = waiters.findIndex((w) => w.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Yanıt zaman asimi."));
        }, timeoutMs);
        waiters.push({ match, resolve, reject, timer });
      });
    }

    async function connectBle() {
      if (!navigator.bluetooth) {
        alert("Bu tarayici Web Bluetooth desteklemiyor.");
        return;
      }
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: "LUMI" }],
          optionalServices: [SERVICE_UUID],
        });

        device.addEventListener("gattserverdisconnected", onDisconnected);
        const gatt = await device.gatt.connect();
        const service = await gatt.getPrimaryService(SERVICE_UUID);
        rx = await service.getCharacteristic(RX_UUID);
        tx = await service.getCharacteristic(TX_UUID);

        await tx.startNotifications();
        notifications = true;

        tx.addEventListener("characteristicvaluechanged", (ev) => {
          const msg = new TextDecoder().decode(ev.target.value).trim();
          log(`ESP -> ${msg}`);
          if (msg.startsWith("MODE:")) renderStatus(msg);
          resolveWaiters(msg);
        });

        setStatus(`Bağlı: ${device.name || "LUMI"}`, true);
        log("Bağlantı kuruldu.");
      } catch (err) {
        log(`Bağlantı hatası: ${err.message}`);
      }
    }

    function onDisconnected() {
      setStatus("Bağlı Değil", false);
      rx = null;
      tx = null;
      notifications = false;
      setLivePreview(false);
      failWaiters("Bağlantı koptu.");
      log("Bağlantı koptu.");
    }

    async function writeText(command) {
      if (!rx) throw new Error("Önce baglan.");
      await rx.writeValue(new TextEncoder().encode(command));
      log(`APP -> ${command}`);
    }

    async function writeBin(bytes) {
      if (!rx) throw new Error("Önce baglan.");
      await rx.writeValue(bytes);
      log(`APP -> BIN[${Array.from(bytes).map(byteHex).join(" ")}]`);
    }

    async function sendTextAck(command, okPrefix, timeoutMs = 2600) {
      return enqueueBleSend(async () => {
        const wait = waitReply((msg) => msg.startsWith(okPrefix) || msg.startsWith("ERR:"), timeoutMs);
        await writeText(command);
        const reply = await wait;
        if (reply.startsWith("ERR:")) throw new Error(reply);
        return reply;
      });
    }

    async function sendBinAck(bytes, okPrefix, timeoutMs = 2800) {
      return enqueueBleSend(async () => {
        const wait = waitReply((msg) => msg.startsWith(okPrefix) || msg.startsWith("ERR:"), timeoutMs);
        await writeBin(bytes);
        const reply = await wait;
        if (reply.startsWith("ERR:")) throw new Error(reply);
        return reply;
      });
    }

    async function sendImage(type, okPrefix) {
      const bytes = Uint8Array.from([type, ...mirrorRowsForDevice(gridToRows())]);
      await sendBinAck(bytes, okPrefix);
    }

