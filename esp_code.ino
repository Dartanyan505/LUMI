\#include <MD_Parola.h>

\#include <MD_MAX72xx.h>

\#include <SPI.h>



\#include <BLEDevice.h>

\#include <BLEServer.h>

\#include <BLEUtils.h>

\#include <BLE2902.h>



// -------------------------

// MATRIX

// -------------------------

\#define HARDWARE_TYPE MD_MAX72XX::FC16_HW

\#define MAX_DEVICES 1



\#define DATA_PIN 14

\#define CS_PIN   13

\#define CLK_PIN  12



\#define MAX_TEXT_LEN 120

\#define MAX_FRAMES   256



MD_Parola display = MD_Parola(HARDWARE_TYPE, DATA_PIN, CLK_PIN, CS_PIN, MAX_DEVICES);

MD_MAX72XX* mx = nullptr;



// -------------------------

// BLE UUIDs

// -------------------------

\#define SERVICE_UUID        "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"

\#define CHARACTERISTIC_RX   "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // phone -> ESP

\#define CHARACTERISTIC_TX   "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // ESP -> phone



BLECharacteristic* pTxCharacteristic = nullptr;

bool deviceConnected = false;



// -------------------------

// Binary packet types

// -------------------------

static const uint8_t PKT_IMG        = 0x01;

static const uint8_t PKT_PREVIEW    = 0x02;

static const uint8_t PKT_ANIM_BEGIN = 0x10;

static const uint8_t PKT_ANIM_CHUNK = 0x11;

static const uint8_t PKT_ANIM_END   = 0x12;



// -------------------------

// APP STATE

// -------------------------

enum RenderMode {

  MODE_IDLE,

  MODE_IMAGE,

  MODE_PREVIEW,

  MODE_ANIMATION,

  MODE_TEXT,

  MODE_TEXT_STATIC

};



struct Frame {

  uint8_t rows[8];

  uint16_t durationMs;

  uint8_t brightness;   // 0..15

};



Frame frames[MAX_FRAMES];



RenderMode currentMode = MODE_IDLE;



uint16_t frameCount = 0;

uint16_t currentFrame = 0;

bool animLoop = true;

bool animPaused = false;

unsigned long lastFrameMs = 0;



char textBuffer[MAX_TEXT_LEN + 1] = {0};

uint16_t textSpeed = 90;

bool textScrollRight = false;

uint8_t currentBrightness = 8;



// Upload state

bool uploadInProgress = false;

uint16_t uploadExpectedFrames = 0;

uint16_t uploadReceivedFrames = 0;

bool uploadLoop = true;



// -------------------------

// DISPLAY HELPERS

// -------------------------



// Display fiziksel olarak 90° saat yönünün tersine dönük

void setPointRotatedCCW(uint8_t row, uint8_t col, bool state) {

  mx->setPoint(7 - col, row, state);

}



void drawBitmapRotatedCCW(const uint8_t bmp[8]) {

  mx->clear();



  for (uint8_t row = 0; row < 8; row++) {

​    for (uint8_t col = 0; col < 8; col++) {

​      bool pixelOn = bitRead(bmp[row], 7 - col);

​      if (pixelOn) {

​        setPointRotatedCCW(row, col, true);

​      }

​    }

  }



  mx->update();

}



void clearScreenOnly() {

  display.displayClear();

  mx->clear();

  mx->update();

}



void setBrightness(uint8_t value) {

  if (value > 15) value = 15;

  currentBrightness = value;

  display.setIntensity(value);

}



void stopAll() {

  currentMode = MODE_IDLE;

  animPaused = false;

  clearScreenOnly();

}



void startImage(const uint8_t rows[8]) {

  currentMode = MODE_IMAGE;

  animPaused = false;

  display.displayClear();

  drawBitmapRotatedCCW(rows);

}



void startPreview(const uint8_t rows[8]) {

  currentMode = MODE_PREVIEW;

  animPaused = false;

  display.displayClear();

  drawBitmapRotatedCCW(rows);

}



void startAnimation() {

  if (frameCount == 0) return;



  currentMode = MODE_ANIMATION;

  animPaused = false;

  currentFrame = 0;

  lastFrameMs = 0;

  display.displayClear();



  setBrightness(frames[0].brightness);

  drawBitmapRotatedCCW(frames[0].rows);

}



void startText(const char* txt, uint16_t speedMs, bool scrollRight) {

  currentMode = MODE_TEXT;

  animPaused = false;

  textSpeed = speedMs;

  textScrollRight = scrollRight;



  strncpy(textBuffer, txt, sizeof(textBuffer) - 1);

  textBuffer[sizeof(textBuffer) - 1] = '\0';



  display.displayClear();



  if (textScrollRight) {

​    display.displayScroll(textBuffer, PA_RIGHT, PA_SCROLL_RIGHT, textSpeed);

  } else {

​    display.displayScroll(textBuffer, PA_LEFT, PA_SCROLL_LEFT, textSpeed);

  }

}



void startStaticText(const char* txt) {

  currentMode = MODE_TEXT_STATIC;

  animPaused = false;



  strncpy(textBuffer, txt, sizeof(textBuffer) - 1);

  textBuffer[sizeof(textBuffer) - 1] = '\0';



  display.displayClear();

  display.displayText(textBuffer, PA_CENTER, 0, 0, PA_PRINT, PA_NO_EFFECT);

  display.displayReset();

}



void processAnimationLoop() {

  if (currentMode != MODE_ANIMATION || frameCount == 0 || animPaused) return;



  unsigned long now = millis();

  if (lastFrameMs == 0 || now - lastFrameMs >= frames[currentFrame].durationMs) {

​    setBrightness(frames[currentFrame].brightness);

​    drawBitmapRotatedCCW(frames[currentFrame].rows);



​    lastFrameMs = now;

​    currentFrame++;



​    if (currentFrame >= frameCount) {

​      if (animLoop) {

​        currentFrame = 0;

​      } else {

​        currentFrame = frameCount - 1;

​        animPaused = true; // son karede dursun

​      }

​    }

  }

}



void processTextLoop() {

  if (currentMode != MODE_TEXT) return;



  if (display.displayAnimate()) {

​    display.displayReset();

  }

}



// -------------------------

// UTILS

// -------------------------

void notifyClient(const String& msg) {

  if (!deviceConnected || pTxCharacteristic == nullptr) return;

  pTxCharacteristic->setValue(msg.c_str());

  pTxCharacteristic->notify();

}



bool parseUInt16Strict(const String& s, uint16_t& out) {

  if (s.length() == 0) return false;

  for (size_t i = 0; i < s.length(); i++) {

​    if (!isDigit(s[i])) return false;

  }

  out = (uint16_t)s.toInt();

  return true;

}



bool parseUInt8Strict(const String& s, uint8_t& out) {

  uint16_t temp;

  if (!parseUInt16Strict(s, temp)) return false;

  if (temp > 255) return false;

  out = (uint8_t)temp;

  return true;

}



bool hexToBytes16(const String& hex, uint8_t out[8]) {

  if (hex.length() != 16) return false;



  auto hexNibble = [](char c) -> int {

​    if (c >= '0' && c <= '9') return c - '0';

​    if (c >= 'A' && c <= 'F') return 10 + (c - 'A');

​    if (c >= 'a' && c <= 'f') return 10 + (c - 'a');

​    return -1;

  };



  for (int i = 0; i < 8; i++) {

​    int hi = hexNibble(hex[i * 2]);

​    int lo = hexNibble(hex[i * 2 + 1]);

​    if (hi < 0 || lo < 0) return false;

​    out[i] = (hi << 4) | lo;

  }



  return true;

}



const char* modeToString(RenderMode mode) {

  switch (mode) {

​    case MODE_IDLE: return "IDLE";

​    case MODE_IMAGE: return "IMAGE";

​    case MODE_PREVIEW: return "PREVIEW";

​    case MODE_ANIMATION: return "ANIMATION";

​    case MODE_TEXT: return "TEXT";

​    case MODE_TEXT_STATIC: return "TEXT_STATIC";

​    default: return "UNKNOWN";

  }

}



String buildStatus() {

  String s = "MODE:";

  s += modeToString(currentMode);

  s += ";BRT:";

  s += String(currentBrightness);

  s += ";FRAMES:";

  s += String(frameCount);

  s += ";LOOP:";

  s += String(animLoop ? 1 : 0);

  s += ";PAUSED:";

  s += String(animPaused ? 1 : 0);

  s += ";UPLOADING:";

  s += String(uploadInProgress ? 1 : 0);

  s += ";UP_EXP:";

  s += String(uploadExpectedFrames);

  s += ";UP_RX:";

  s += String(uploadReceivedFrames);



  if (currentMode == MODE_TEXT || currentMode == MODE_TEXT_STATIC) {

​    s += ";TEXT:";

​    s += textBuffer;

  }



  return s;

}



void printHelp() {

  Serial.println("TEXT COMMANDS:");

  Serial.println("  PING");

  Serial.println("  HELP");

  Serial.println("  STATUS");

  Serial.println("  BRT:8");

  Serial.println("  TXT:90,HELLO");

  Serial.println("  TXT_R:90,HELLO");

  Serial.println("  TXT_STATIC:A");

  Serial.println("  CLEAR");

  Serial.println("  STOP");

  Serial.println("  ANICLR");

  Serial.println("  PLAY:ANIM");

  Serial.println("  ANIPAUSE");

  Serial.println("  ANIRESUME");

  Serial.println("  ANISTOP");

  Serial.println("");

  Serial.println("BINARY PACKETS:");

  Serial.println("  IMG        [0x01][8 bytes]");

  Serial.println("  PREVIEW    [0x02][8 bytes]");

  Serial.println("  BEGIN      [0x10][frameCountL][frameCountH][loop][reserved]");

  Serial.println("  CHUNK      [0x11][startL][startH][count][frames...]");

  Serial.println("             each frame = [durationL][durationH][brightness][8 bytes]");

  Serial.println("  END        [0x12]");

}



// -------------------------

// TEXT COMMAND HANDLER

// -------------------------

void handleCommand(String cmd) {

  cmd.trim();

  if (cmd.length() == 0) return;



  Serial.print("RX TXT: ");

  Serial.println(cmd);



  if (cmd == "PING") {

​    notifyClient("PONG");

​    return;

  }



  if (cmd == "HELP") {

​    notifyClient("OK:HELP");

​    printHelp();

​    return;

  }



  if (cmd == "STATUS") {

​    notifyClient(buildStatus());

​    return;

  }



  if (cmd == "STOP") {

​    stopAll();

​    notifyClient("OK:STOP");

​    return;

  }



  if (cmd == "CLEAR") {

​    clearScreenOnly();

​    notifyClient("OK:CLEAR");

​    return;

  }



  if (cmd == "ANICLR") {

​    frameCount = 0;

​    currentFrame = 0;

​    animPaused = false;

​    uploadInProgress = false;

​    uploadExpectedFrames = 0;

​    uploadReceivedFrames = 0;

​    notifyClient("OK:ANICLR");

​    return;

  }



  if (cmd == "ANISTOP") {

​    if (currentMode == MODE_ANIMATION) {

​      currentMode = MODE_IDLE;

​      animPaused = false;

​      clearScreenOnly();

​      notifyClient("OK:ANISTOP");

​    } else {

​      notifyClient("ERR:NO_ACTIVE_ANIM");

​    }

​    return;

  }



  if (cmd == "ANIPAUSE") {

​    if (currentMode == MODE_ANIMATION) {

​      animPaused = true;

​      notifyClient("OK:ANIPAUSE");

​    } else {

​      notifyClient("ERR:NO_ACTIVE_ANIM");

​    }

​    return;

  }



  if (cmd == "ANIRESUME") {

​    if (currentMode == MODE_ANIMATION && frameCount > 0) {

​      animPaused = false;

​      lastFrameMs = millis();

​      notifyClient("OK:ANIRESUME");

​    } else {

​      notifyClient("ERR:NO_ACTIVE_ANIM");

​    }

​    return;

  }



  if (cmd == "PLAY:ANIM") {

​    if (uploadInProgress) {

​      notifyClient("ERR:UPLOAD_IN_PROGRESS");

​      return;

​    }

​    if (frameCount == 0) {

​      notifyClient("ERR:NO_FRAMES");

​      return;

​    }

​    startAnimation();

​    notifyClient("OK:PLAY_ANIM");

​    return;

  }



  if (cmd.startsWith("BRT:")) {

​    String valueStr = cmd.substring(4);

​    uint8_t val;

​    if (!parseUInt8Strict(valueStr, val) || val > 15) {

​      notifyClient("ERR:BAD_BRIGHTNESS");

​      return;

​    }

​    setBrightness(val);

​    notifyClient("OK:BRT");

​    return;

  }



  if (cmd.startsWith("TXT:")) {

​    String rest = cmd.substring(4);

​    int comma = rest.indexOf(',');

​    if (comma < 0) {

​      notifyClient("ERR:BAD_TXT");

​      return;

​    }



​    String speedStr = rest.substring(0, comma);

​    String txt = rest.substring(comma + 1);



​    uint16_t speed;

​    if (!parseUInt16Strict(speedStr, speed) || speed == 0) {

​      notifyClient("ERR:BAD_TEXT_SPEED");

​      return;

​    }



​    txt.trim();

​    if (txt.length() == 0) {

​      notifyClient("ERR:EMPTY_TEXT");

​      return;

​    }



​    if (txt.length() > MAX_TEXT_LEN) {

​      notifyClient("ERR:TEXT_TOO_LONG");

​      return;

​    }



​    startText(txt.c_str(), speed, false);

​    notifyClient("OK:TXT");

​    return;

  }



  if (cmd.startsWith("TXT_R:")) {

​    String rest = cmd.substring(6);

​    int comma = rest.indexOf(',');

​    if (comma < 0) {

​      notifyClient("ERR:BAD_TXT_R");

​      return;

​    }



​    String speedStr = rest.substring(0, comma);

​    String txt = rest.substring(comma + 1);



​    uint16_t speed;

​    if (!parseUInt16Strict(speedStr, speed) || speed == 0) {

​      notifyClient("ERR:BAD_TEXT_SPEED");

​      return;

​    }



​    txt.trim();

​    if (txt.length() == 0) {

​      notifyClient("ERR:EMPTY_TEXT");

​      return;

​    }



​    if (txt.length() > MAX_TEXT_LEN) {

​      notifyClient("ERR:TEXT_TOO_LONG");

​      return;

​    }



​    startText(txt.c_str(), speed, true);

​    notifyClient("OK:TXT_R");

​    return;

  }



  if (cmd.startsWith("TXT_STATIC:")) {

​    String txt = cmd.substring(11);

​    txt.trim();



​    if (txt.length() == 0) {

​      notifyClient("ERR:EMPTY_TEXT");

​      return;

​    }



​    if (txt.length() > MAX_TEXT_LEN) {

​      notifyClient("ERR:TEXT_TOO_LONG");

​      return;

​    }



​    startStaticText(txt.c_str());

​    notifyClient("OK:TXT_STATIC");

​    return;

  }



  notifyClient("ERR:UNKNOWN");

}



// -------------------------

// BINARY PACKET HANDLER

// -------------------------

bool handleBinaryPacket(const uint8_t* data, size_t len) {

  if (len == 0) {

​    notifyClient("ERR:EMPTY_PACKET");

​    return false;

  }



  uint8_t type = data[0];

  Serial.print("RX BIN TYPE: 0x");

  Serial.println(type, HEX);



  if (type == PKT_IMG) {

​    if (len != 9) {

​      notifyClient("ERR:BAD_IMG_PKT");

​      return false;

​    }



​    startImage(&data[1]);

​    notifyClient("OK:IMG_BIN");

​    return true;

  }



  if (type == PKT_PREVIEW) {

​    if (len != 9) {

​      notifyClient("ERR:BAD_PREVIEW_PKT");

​      return false;

​    }



​    startPreview(&data[1]);

​    notifyClient("OK:PREVIEW_BIN");

​    return true;

  }



  if (type == PKT_ANIM_BEGIN) {

​    if (len != 5) {

​      notifyClient("ERR:BAD_BEGIN_PKT");

​      return false;

​    }



​    uint16_t expected = (uint16_t)data[1] | ((uint16_t)data[2] << 8);

​    uint8_t loopVal = data[3];



​    if (expected == 0) {

​      notifyClient("ERR:BAD_FRAME_COUNT");

​      return false;

​    }



​    if (expected > MAX_FRAMES) {

​      notifyClient("ERR:FRAME_OVERFLOW");

​      return false;

​    }



​    if (loopVal > 1) {

​      notifyClient("ERR:BAD_LOOP");

​      return false;

​    }



​    frameCount = 0;

​    currentFrame = 0;

​    uploadInProgress = true;

​    uploadExpectedFrames = expected;

​    uploadReceivedFrames = 0;

​    uploadLoop = (loopVal != 0);

​    animLoop = uploadLoop;

​    animPaused = false;



​    notifyClient("OK:BEGIN");

​    return true;

  }



  if (type == PKT_ANIM_CHUNK) {

​    if (!uploadInProgress) {

​      notifyClient("ERR:NO_UPLOAD");

​      return false;

​    }



​    if (len < 4) {

​      notifyClient("ERR:BAD_CHUNK_PKT");

​      return false;

​    }



​    uint16_t frameStart = (uint16_t)data[1] | ((uint16_t)data[2] << 8);

​    uint8_t count = data[3];



​    if (count == 0) {

​      notifyClient("ERR:BAD_CHUNK_COUNT");

​      return false;

​    }



​    const size_t headerSize = 4;

​    const size_t frameSize = 11;

​    size_t expectedLen = headerSize + ((size_t)count * frameSize);



​    if (len != expectedLen) {

​      notifyClient("ERR:BAD_CHUNK_LEN");

​      return false;

​    }



​    if (frameStart + count > uploadExpectedFrames || frameStart + count > MAX_FRAMES) {

​      notifyClient("ERR:FRAME_OVERFLOW");

​      return false;

​    }



​    const uint8_t* p = &data[4];



​    for (uint8_t i = 0; i < count; i++) {

​      uint16_t idx = frameStart + i;



​      uint16_t duration = (uint16_t)p[0] | ((uint16_t)p[1] << 8);

​      uint8_t brightness = p[2];



​      if (duration == 0) {

​        notifyClient("ERR:BAD_DURATION");

​        return false;

​      }



​      if (brightness > 15) {

​        notifyClient("ERR:BAD_BRIGHTNESS");

​        return false;

​      }



​      frames[idx].durationMs = duration;

​      frames[idx].brightness = brightness;

​      memcpy(frames[idx].rows, &p[3], 8);



​      p += frameSize;

​    }



​    uint16_t chunkEnd = frameStart + count;

​    if (chunkEnd > uploadReceivedFrames) {

​      uploadReceivedFrames = chunkEnd;

​    }



​    if (uploadReceivedFrames > frameCount) {

​      frameCount = uploadReceivedFrames;

​    }



​    notifyClient("OK:CHUNK");

​    return true;

  }



  if (type == PKT_ANIM_END) {

​    if (!uploadInProgress) {

​      notifyClient("ERR:NO_UPLOAD");

​      return false;

​    }



​    if (len != 1) {

​      notifyClient("ERR:BAD_END_PKT");

​      return false;

​    }



​    if (uploadReceivedFrames != uploadExpectedFrames) {

​      notifyClient("ERR:UPLOAD_INCOMPLETE");

​      return false;

​    }



​    uploadInProgress = false;

​    frameCount = uploadExpectedFrames;

​    animLoop = uploadLoop;



​    notifyClient("OK:END");

​    return true;

  }



  notifyClient("ERR:UNKNOWN_PACKET");

  return false;

}



// -------------------------

// BLE CALLBACKS

// -------------------------

class ServerCallbacks : public BLEServerCallbacks {

  void onConnect(BLEServer* pServer) override {

​    deviceConnected = true;

​    Serial.println("BLE connected");

  }



  void onDisconnect(BLEServer* pServer) override {

​    deviceConnected = false;

​    Serial.println("BLE disconnected");

​    BLEDevice::startAdvertising();

  }

};



class RxCallbacks : public BLECharacteristicCallbacks {

  void onWrite(BLECharacteristic* pCharacteristic) override {

​    size_t len = pCharacteristic->getLength();

​    uint8_t* data = pCharacteristic->getData();



​    if (len == 0 || data == nullptr) return;



​    uint8_t first = data[0];



​    // Binary packet

​    if (first == PKT_IMG || first == PKT_PREVIEW || first == PKT_ANIM_BEGIN ||

​        first == PKT_ANIM_CHUNK || first == PKT_ANIM_END) {

​      handleBinaryPacket(data, len);

​      return;

​    }



​    // Text command

​    String cmd;

​    cmd.reserve(len);

​    for (size_t i = 0; i < len; i++) {

​      cmd += (char)data[i];

​    }

​    handleCommand(cmd);

  }

};



// -------------------------

// SETUP / LOOP

// -------------------------

void setup() {

  Serial.begin(115200);

  delay(800);

  Serial.println("ESP32-H2 BLE Matrix starting...");



  display.begin();

  setBrightness(8);

  display.displayClear();



  mx = display.getGraphicObject();

  mx->clear();

  mx->update();



  BLEDevice::init("LUMI");

  BLEServer* pServer = BLEDevice::createServer();

  pServer->setCallbacks(new ServerCallbacks());



  BLEService* pService = pServer->createService(SERVICE_UUID);



  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(

​    CHARACTERISTIC_RX,

​    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR

  );



  pTxCharacteristic = pService->createCharacteristic(

​    CHARACTERISTIC_TX,

​    BLECharacteristic::PROPERTY_NOTIFY

  );



  pTxCharacteristic->addDescriptor(new BLE2902());

  pRxCharacteristic->setCallbacks(new RxCallbacks());



  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();

  pAdvertising->start();



  Serial.println("BLE advertising as LUMI");

  printHelp();

}



void loop() {

  processTextLoop();

  processAnimationLoop();

}
