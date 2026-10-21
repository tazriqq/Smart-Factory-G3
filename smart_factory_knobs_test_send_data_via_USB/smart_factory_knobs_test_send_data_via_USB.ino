/*
  Smart Factory · 4 speed knobs
  --------------------------------
  Four potentiometers, one per machine on the "Smart Factory Line" page:
    knob 1 → 01 Swiss-type lathe
    knob 2 → 02 CNC turning center
    knob 3 → 03 GENOS M250
    knob 4 → 04 CNC router
  Knob fully left = 0 % (machine stops), middle = 100 %, fully right = 200 %.

  The board sends one text line per update, the four readings 0..1023 separated by commas:
      512,300,1023,800\n
  over BOTH of these at the same time, so the page can use either:
    • USB cable  → Web Serial, 115200 baud      (page: "Board via" = USB cable)
    • Bluetooth  → BLE Nordic UART, name CNC-Knobs (page: "Board via" = Bluetooth, ESP32 only)

  Boards
    • ESP32 (any DevKit): USB + Bluetooth.   Tools → Board → "ESP32 Dev Module"
    • Arduino Nano / Uno: USB only.          Tools → Board → "Arduino Nano" or "Arduino Uno"

  Wiring (each knob is a 10 kΩ linear potentiometer, 3 legs)
      outer leg 1  → GND
      middle leg   → signal pin (table below)
      outer leg 3  → 3V3 on ESP32  /  5V on Nano·Uno
    !! On ESP32 use 3V3, never 5V: the input pins take at most 3.3 V.

                 knob 1   knob 2   knob 3   knob 4      → sent as A0, A1, A2, A3 (in this order)
      ESP32      VP/36    VN/39    GPIO34   GPIO35      four pins side by side on the DevKit header,
                                                          right below EN: 3V3 · EN · VP · VN · 34 · 35
      Nano/Uno   A0       A1       A2       A3

    The ESP32 pins are all ADC1 (they keep working while Bluetooth is on) and input-only, which is fine for knobs.

  If a knob turns the wrong way, swap its two outer legs, or tick "Reverse" under that knob on the page.
*/

const int COUNT = 4;

#if defined(ESP32)
  const int PINS[COUNT] = {36, 39, 34, 35};   // knob 1..4 = VP, VN, 34, 35 (header order)
  const int ADC_MAX = 4095;                  // ESP32 reads 12 bits
#else
  const int PINS[COUNT] = {A0, A1, A2, A3};   // knob 1..4
  const int ADC_MAX = 1023;                  // Nano / Uno read 10 bits
#endif

const unsigned long SEND_EVERY_MS = 50;      // 20 updates a second while a knob moves
const unsigned long HEARTBEAT_MS  = 1000;    // and once a second when nothing changes
const int DEADBAND = 3;                      // ignore jitter smaller than this (0..1023 scale)
const float SMOOTH = 0.25;                   // 0..1, lower = smoother but slower

float filtered[COUNT];
int sent[COUNT];
unsigned long lastSend = 0, lastBeat = 0;

// ---------------------------------------------------------------- Bluetooth (ESP32 only)
#if defined(ESP32)
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

// Nordic UART Service: the page listens for notifications on the TX characteristic
#define NUS_SERVICE "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX      "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

BLECharacteristic *txChar = nullptr;
bool bleConnected = false;

class ServerEvents : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override { bleConnected = true; }
  void onDisconnect(BLEServer *server) override {
    bleConnected = false;
    BLEDevice::startAdvertising();           // let the page pair again
  }
};

void startBluetooth() {
  BLEDevice::init("CNC-Knobs");              // the page looks for this name
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerEvents());
  BLEService *service = server->createService(NUS_SERVICE);
  txChar = service->createCharacteristic(NUS_TX, BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());
  service->createCharacteristic(NUS_RX, BLECharacteristic::PROPERTY_WRITE);
  service->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void sendBluetooth(const char *line, size_t len) {
  if (!bleConnected || txChar == nullptr) return;
  txChar->setValue((uint8_t *)line, len);    // one line ("512,300,1023,800\n") fits in one packet
  txChar->notify();
}
#endif

// ---------------------------------------------------------------- knobs
int readKnob(int i) {
  long raw = analogRead(PINS[i]);
  return (int)(raw * 1023L / ADC_MAX);       // same 0..1023 scale on every board
}

void setup() {
  Serial.begin(115200);
#if defined(ESP32)
  analogReadResolution(12);
  for (int i = 0; i < COUNT; i++) analogSetPinAttenuation(PINS[i], ADC_11db);   // full 0..3.3 V range
  startBluetooth();
#endif
  for (int i = 0; i < COUNT; i++) { filtered[i] = readKnob(i); sent[i] = -1; }
  Serial.println("# Smart Factory knobs ready: 4 values 0..1023 per line");
}

void loop() {
  bool changed = false;
  for (int i = 0; i < COUNT; i++) {
    filtered[i] += SMOOTH * (readKnob(i) - filtered[i]);
    int v = (int)(filtered[i] + 0.5);
    // snap to the ends so 0 % and 200 % are reachable despite noise
    if (v <= DEADBAND) v = 0;
    if (v >= 1023 - DEADBAND) v = 1023;
    if (sent[i] < 0 || abs(v - sent[i]) > DEADBAND || ((v == 0 || v == 1023) && v != sent[i])) {
      sent[i] = v;
      changed = true;
    }
  }

  unsigned long now = millis();
  if ((changed && now - lastSend >= SEND_EVERY_MS) || now - lastBeat >= HEARTBEAT_MS) {
    char line[32];
    int len = snprintf(line, sizeof(line), "%d,%d,%d,%d\n", sent[0], sent[1], sent[2], sent[3]);
    Serial.print(line);
#if defined(ESP32)
    sendBluetooth(line, len);
#endif
    lastSend = now;
    lastBeat = now;
  }
  delay(5);
}
