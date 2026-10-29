// SmartFactoryBoard_MQTT.ino  -  ESP32 DevKit (38-pin), Arduino core 3.x
//
// Simulates four machines in a line and the signals they would send, and sends them several ways at once:
//   USB        one JSON line every 100 ms (and at once when something changes), 115200 baud
//   Bluetooth  the same line over BLE "Nordic UART" (name CNC-Knobs), in 20-byte pieces
//   Wi-Fi      GET http://192.168.1.200/data  ->  the same line
//   MQTT       the same line to a broker (topic MQTT_TOPIC), so the website works from anywhere,
//              plus events and a one-minute summary per machine (MQTT_EVENTS / MQTT_MINUTES), which the
//              server stores in its database to work out OEE (server/postgres/schema.sql)
//
// The machines: each one makes a part every CYCLE_MS (at 100 % speed) while it runs, i.e. its run switch
// is on, there is no alarm, its knob is above 0 % and its door is closed. Machine 1 always has material;
// machines 2-4 start a part only when the machine before has handed one over (up to BUF_CAP waiting),
// so the line flows like the website draws it. Machine 4's parts are the line's output.
//
// The line:
//   {"pot":[512,700,1023,0],"run":[1,0,1,1],"door":[0,0,1,0],"al":0,"cnt":[12,5,8,3],"good":10,"rej":2,"ms":123456}
//   pot   knob of machines 1-4, 0..1023 (left out when HAVE_POTS is false)
//   run   run switch of machines 1-4: 1 = running
//   door  door of machines 1-4: 1 = open (the machine stands still)
//   al    alarm / E-stop: 1 = alarm
//   cnt   parts finished by machines 1-4 since power-on (only ever counts up)
//   good  QC good presses since power-on
//   rej   QC reject presses since power-on
//   ms    time since power-on, so the pages can tell when the board restarted
//
// Rows for the database (one JSON message each):
//   events   {"machine":1,"event":"part","age_ms":0}
//            machine 1-4, 0 = the whole line; event = part, run_on, run_off, door_open, door_close,
//            alarm_on, alarm_off, good, reject, boot
//   minutes  {"machine":1,"run_s":55,"stop_s":5,"alarm_s":0,"parts":1,"speed_pct":100,"age_ms":0}
//            run = run switch on, no alarm, knob above 0 % and door closed  (the same rule as the website)
//   age_ms = how long the row waited here (rows queue while MQTT is down), so the server can set the
//   right time without the board needing the internet for its clock
//
// Wiring: every switch and button goes between its GPIO and GND (no resistors, INPUT_PULLUP).
//   Run 1-4       7x7 latching   GPIO 25, 26, 27, 14
//   Alarm         7x7 latching   GPIO 13
//   Door 1-4      6x6 tactile    GPIO 23, 19, 18, 17   (each press opens / closes that machine's door)
//   Good / Reject 6x6 tactile    GPIO 16 / 4           (QC: one output part is good / scrap)
//   Knobs 1-4     pot wiper      GPIO 32, 33, 34, 35  (outer pins to 3.3 V and GND)
//   Alarm light   on-board LED   GPIO 2
//
// Libraries: PubSubClient (by Nick O'Leary) from the Library Manager.
// Passwords: copy secrets.example.h to secrets.h and fill it in (secrets.h is not uploaded to GitHub).
// Arduino IDE: Board "ESP32 Dev Module",
//              Partition Scheme "Huge APP (3MB No OTA/1MB SPIFFS)"  (Wi-Fi + Bluetooth need it)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// passwords and private addresses live in secrets.h, which is not uploaded to GitHub
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "secrets.h is missing: copy secrets.example.h to secrets.h in this folder and fill in your Wi-Fi and passwords"
#endif

// one row for the database (defined up here so the Arduino IDE's generated prototypes can see it)
struct Row {
  uint8_t minute;        // 0 = events row, 1 = minutes row
  int8_t machine;        // 1-4, 0 = the whole line
  uint32_t at;           // millis() when it happened
  char ev[12];
  uint16_t runS, stopS, alarmS, parts, speed;
};

// ---------- settings ----------
const bool HAVE_POTS  = true;   // false if the four pots are not wired (floating pins read noise)
const bool USE_WIFI   = true;   // false to skip Wi-Fi (USB and Bluetooth still work; no MQTT)
const bool USE_BLE    = true;
const bool USE_MQTT   = true;
const bool USE_LOG    = true;   // events and minute rows for the database (over MQTT)

const char* ssid     = SECRET_WIFI_SSID;
const char* password = SECRET_WIFI_PASS;
IPAddress local_IP(192, 168, 1, 200);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);

// MQTT broker: set in secrets.h
const char* MQTT_HOST   = SECRET_MQTT_HOST;
const int   MQTT_PORT   = SECRET_MQTT_PORT;
const bool  MQTT_TLS    = SECRET_MQTT_TLS;
const char* MQTT_USER   = SECRET_MQTT_USER;
const char* MQTT_PASS   = SECRET_MQTT_PASS;
const char* MQTT_TOPIC  = "group3/dpx/line1/board";    // the website subscribes to this
const char* MQTT_STATUS = "group3/dpx/line1/status";   // "online" / "offline", kept by the broker
const char* MQTT_EVENTS  = "group3/dpx/line1/events";  // rows for the database
const char* MQTT_MINUTES = "group3/dpx/line1/minutes";

// ---------- pins ----------
const int POT_PIN[4]  = {32, 33, 34, 35};
const int RUN_PIN[4]  = {25, 26, 27, 14};
const int ALARM_PIN   = 13;
const int DOOR_PIN[4] = {23, 19, 18, 17};
const int GOOD_PIN    = 16;
const int REJECT_PIN  = 4;
const int LED_PIN     = 2;

// ---------- Bluetooth: Nordic UART Service (the pages look for this) ----------
#define BLE_NAME     "CNC-Knobs"
#define NUS_SERVICE  "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX       "6e400002-b5a3-f393-e0a9-e50e24dcca9e"   // page -> board (unused)
#define NUS_TX       "6e400003-b5a3-f393-e0a9-e50e24dcca9e"   // board -> page (notify)

// ---------- timing ----------
const uint32_t DEBOUNCE_MS   = 25;
const uint32_t SAMPLE_MS     = 10;    // read pots 100 times a second
const uint32_t SEND_EVERY_MS = 100;   // a line at least 10 times a second
const uint32_t MIN_GAP_MS    = 20;    // ...and at most 50 times a second when things change fast
const uint32_t MQTT_EVERY_MS = 1000;  // MQTT: a line every second (the pages call 2.5 s of silence "no data")
const uint32_t MQTT_GAP_MS   = 200;   // ...and at most 5 a second when things change (keeps broker traffic low)
const int      MQTT_POT_STEP = 8;     // a knob counts as changed when it moves this much (0..1023)
const uint32_t SUMMARY_MS    = 60000; // one minutes row per machine

// ======================================================================
// Buttons and switches (pressed / latched = pin pulled to GND = LOW)
// ======================================================================
struct Input {
  int pin;
  bool stable;     // debounced state, true = pressed / latched
  bool raw;
  uint32_t at;
};

void beginInput(Input& in, int pin) {
  pinMode(pin, INPUT_PULLUP);
  delay(2);
  bool p = digitalRead(pin) == LOW;
  in = {pin, p, p, millis()};
}

// returns +1 when it becomes pressed, -1 when released, 0 otherwise
int updateInput(Input& in) {
  bool p = digitalRead(in.pin) == LOW;
  uint32_t now = millis();
  if (p != in.raw) { in.raw = p; in.at = now; }
  if (in.stable != in.raw && now - in.at >= DEBOUNCE_MS) {
    in.stable = in.raw;
    return in.stable ? 1 : -1;
  }
  return 0;
}

Input runIn[4], doorIn[4], alarmIn, goodIn, rejIn;
bool doorOpen[4] = {false, false, false, false};
uint32_t partCount[4] = {0, 0, 0, 0};

// ---------- the machines ----------
const uint32_t CYCLE_MS[4] = {18000, 30000, 24000, 36000};   // one part at 100 % speed (the website's std cycle)
const int BUF_CAP = 48;                                      // parts that fit between two machines
float workMs[4] = {0, 0, 0, 0};                              // progress on the part in the machine
bool busy[4] = {false, false, false, false};                 // a part is in the machine
int buf[3] = {0, 0, 0};                                      // parts waiting after machines 1-3
uint32_t goodCount = 0, rejCount = 0;
uint16_t potValue[4] = {0, 0, 0, 0};
float potFiltered[4] = {0, 0, 0, 0};

void readPots() {
  static bool first = true;
  for (int n = 0; n < 4; n++) {
    uint32_t sum = 0;
    for (int k = 0; k < 8; k++) sum += analogRead(POT_PIN[n]);   // 0..4095
    float v = sum / 8.0f / 4.0f;                                 // 0..1023
    potFiltered[n] = first ? v : potFiltered[n] + 0.3f * (v - potFiltered[n]);
    potValue[n] = (uint16_t)constrain(lroundf(potFiltered[n]), 0L, 1023L);
  }
  first = false;
}

// knob -> speed %, as the website does it: 0..200 % in 5 % steps, the middle of the travel is 100 %
int speedPct(int n) {
  if (!HAVE_POTS) return 100;
  return (int)lroundf(potValue[n] / 1023.0f * 40.0f) * 5;
}

void logEvent(int machine, const char* ev);   // rows for the database, below

// true when anything the pages care about changed
bool readSwitches() {
  bool changed = false;
  for (int n = 0; n < 4; n++) {
    int r = updateInput(runIn[n]);
    if (r != 0) { changed = true; logEvent(n + 1, r > 0 ? "run_on" : "run_off"); }
    if (updateInput(doorIn[n]) == 1) { doorOpen[n] = !doorOpen[n]; changed = true; logEvent(n + 1, doorOpen[n] ? "door_open" : "door_close"); }
  }
  int a = updateInput(alarmIn);
  if (a != 0) { changed = true; logEvent(0, a > 0 ? "alarm_on" : "alarm_off"); }
  if (updateInput(goodIn) == 1) { goodCount++; changed = true; logEvent(0, "good"); }
  if (updateInput(rejIn) == 1) { rejCount++; changed = true; logEvent(0, "reject"); }
  digitalWrite(LED_PIN, alarmIn.stable ? HIGH : LOW);
  return changed;
}

int makeLine(char* buf, size_t size) {
  int n = 0;
  n += snprintf(buf + n, size - n, "{");
  if (HAVE_POTS)
    n += snprintf(buf + n, size - n, "\"pot\":[%u,%u,%u,%u],",
                  potValue[0], potValue[1], potValue[2], potValue[3]);
  n += snprintf(buf + n, size - n,
                "\"run\":[%d,%d,%d,%d],\"door\":[%d,%d,%d,%d],\"al\":%d,\"cnt\":[%lu,%lu,%lu,%lu],\"good\":%lu,\"rej\":%lu,\"ms\":%lu}",
                runIn[0].stable, runIn[1].stable, runIn[2].stable, runIn[3].stable,
                doorOpen[0], doorOpen[1], doorOpen[2], doorOpen[3], alarmIn.stable,
                (unsigned long)partCount[0], (unsigned long)partCount[1],
                (unsigned long)partCount[2], (unsigned long)partCount[3],
                (unsigned long)goodCount, (unsigned long)rejCount, (unsigned long)millis());
  return n;
}

// ======================================================================
// Wi-Fi
// ======================================================================
WebServer server(80);
char lastLine[256] = "{}";

void handleData() {
  server.sendHeader("Access-Control-Allow-Origin", "*");            // pages opened from a file
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", lastLine);
}

void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.send(204);
}

void startWiFi() {
  WiFi.mode(WIFI_STA);
  if (!WiFi.config(local_IP, gateway, subnet, primaryDNS)) Serial.println("# Wi-Fi: static IP setup failed");
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);                 // does not wait: USB and Bluetooth start right away
  Serial.printf("# Wi-Fi: connecting to %s ...\n", ssid);
  server.on("/data", HTTP_GET, handleData);
  server.on("/data", HTTP_OPTIONS, handleOptions);
  server.on("/", HTTP_GET, []() {
    server.send(200, "text/plain", "Smart factory board. Live data: /data\n");
  });
  server.begin();
}

void watchWiFi() {
  static bool was = false;
  bool now = WiFi.status() == WL_CONNECTED;
  if (now && !was) Serial.printf("# Wi-Fi: connected, data at http://%s/data\n", WiFi.localIP().toString().c_str());
  if (!now && was) Serial.println("# Wi-Fi: lost connection, retrying ...");
  was = now;
}

// ======================================================================
// MQTT
// ======================================================================
WiFiClient mqttPlain;
WiFiClientSecure mqttSecure;
PubSubClient mqtt;

void startMQTT() {
  if (MQTT_TLS) {
    mqttSecure.setInsecure();                 // encrypted, but the broker's certificate is not checked
    mqttSecure.setHandshakeTimeout(5);
    mqtt.setClient(mqttSecure);
  } else {
    mqtt.setClient(mqttPlain);
  }
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  mqtt.setSocketTimeout(3);
  mqtt.setKeepAlive(15);
}

// connects again when needed; tries at most every 5 s so USB and Bluetooth keep running
void watchMQTT() {
  static uint32_t lastTry = 0;
  static bool was = false;
  if (mqtt.connected()) { mqtt.loop(); return; }
  if (was) { was = false; Serial.println("# MQTT: lost connection"); }
  if (WiFi.status() != WL_CONNECTED || millis() - lastTry < 5000) return;
  lastTry = millis();
  char id[32];
  snprintf(id, sizeof id, "dpx-board-%08lx", (unsigned long)(ESP.getEfuseMac() & 0xffffffff));
  Serial.printf("# MQTT: connecting to %s:%d ...\n", MQTT_HOST, MQTT_PORT);
  bool ok = mqtt.connect(id, MQTT_USER[0] ? MQTT_USER : nullptr, MQTT_PASS[0] ? MQTT_PASS : nullptr,
                         MQTT_STATUS, 0, true, "offline");   // the broker posts "offline" if the board drops
  if (ok) {
    was = true;
    mqtt.publish(MQTT_STATUS, "online", true);
    Serial.printf("# MQTT: connected, publishing to %s\n", MQTT_TOPIC);
  } else {
    Serial.printf("# MQTT: failed (state %d, free heap %u)\n", mqtt.state(), ESP.getFreeHeap());
  }
}

// publish when something changed (at most every MQTT_GAP_MS), otherwise every MQTT_EVERY_MS
bool mqttPending = true;   // a switch changed since the last MQTT message

void publishMQTT(const char* line) {
  static uint32_t lastPub = 0;
  static uint16_t lastPot[4] = {0, 0, 0, 0};
  if (!mqtt.connected()) return;
  if (HAVE_POTS)
    for (int n = 0; n < 4; n++) if (abs((int)potValue[n] - (int)lastPot[n]) >= MQTT_POT_STEP) mqttPending = true;
  uint32_t now = millis();
  if ((mqttPending && now - lastPub >= MQTT_GAP_MS) || now - lastPub >= MQTT_EVERY_MS) {
    if (mqtt.publish(MQTT_TOPIC, line)) {
      lastPub = now;
      mqttPending = false;
      memcpy(lastPot, potValue, sizeof lastPot);
    }
  }
}

// ======================================================================
// Rows for the database: they wait in a ring buffer and go out over MQTT a few at a time,
// so a dropped connection loses nothing until the buffer is full (LOG_SIZE rows ≈ 2 hours of minute rows)
// ======================================================================
const int LOG_SIZE = 600;
Row logBuf[LOG_SIZE];
int logHead = 0, logCount = 0;   // oldest row, number of rows waiting

void queueRow(const Row& r) {
  if (logCount == LOG_SIZE) {                // full: drop the oldest
    logHead = (logHead + 1) % LOG_SIZE;
    logCount--;
    Serial.println("# Log: buffer full, oldest row dropped");
  }
  logBuf[(logHead + logCount) % LOG_SIZE] = r;
  logCount++;
}

void logEvent(int machine, const char* ev) {
  if (!USE_LOG) return;
  Row r = {};
  r.minute = 0; r.machine = machine; r.at = millis();
  strncpy(r.ev, ev, sizeof r.ev - 1);
  queueRow(r);
}

// run / stop / alarm time per machine, added up every pass of loop() and written once a minute
uint32_t runMs[4], stopMs[4], alarmMs[4], partsAtSummary[4];

bool running(int n) { return !alarmIn.stable && runIn[n].stable && !doorOpen[n] && speedPct(n) > 0; }

void tallyMachines(uint32_t dt) {
  for (int n = 0; n < 4; n++) {
    if (alarmIn.stable) { stopMs[n] += dt; alarmMs[n] += dt; }
    else if (running(n)) runMs[n] += dt;
    else stopMs[n] += dt;
  }
}

// make parts: true when one was finished (so the line goes out at once)
bool workMachines(uint32_t dt) {
  bool made = false;
  for (int n = 0; n < 4; n++) {
    if (!busy[n]) {                                    // take the next part in, if there is one
      if (n == 0) busy[n] = true;                      // machine 1 has its own bar feeder
      else if (buf[n - 1] > 0) { buf[n - 1]--; busy[n] = true; }
    }
    if (!busy[n] || !running(n)) continue;
    if (workMs[n] < CYCLE_MS[n]) workMs[n] += dt * speedPct(n) / 100.0f;
    if (workMs[n] < CYCLE_MS[n]) continue;
    if (n < 3 && buf[n] >= BUF_CAP) continue;          // no room after it: wait with the part done
    if (n < 3) buf[n]++;
    partCount[n]++;
    logEvent(n + 1, "part");
    busy[n] = false; workMs[n] = 0; made = true;
  }
  return made;
}

void writeSummary() {
  uint32_t at = millis();
  for (int n = 0; n < 4; n++) {
    if (USE_LOG) {
      Row r = {};
      r.minute = 1; r.machine = n + 1; r.at = at;
      r.runS = (runMs[n] + 500) / 1000; r.stopS = (stopMs[n] + 500) / 1000; r.alarmS = (alarmMs[n] + 500) / 1000;
      r.parts = partCount[n] - partsAtSummary[n];
      r.speed = speedPct(n);
      queueRow(r);
    }
    runMs[n] = stopMs[n] = alarmMs[n] = 0;
    partsAtSummary[n] = partCount[n];
  }
}

// send up to 8 waiting rows per pass of loop(), oldest first
void flushLog() {
  if (!logCount || !mqtt.connected()) return;
  for (int k = 0; k < 8 && logCount; k++) {
    const Row& r = logBuf[logHead];
    char b[160];
    unsigned long age = millis() - r.at;
    if (r.minute)
      snprintf(b, sizeof b, "{\"machine\":%d,\"run_s\":%u,\"stop_s\":%u,\"alarm_s\":%u,\"parts\":%u,\"speed_pct\":%u,\"age_ms\":%lu}",
               r.machine, r.runS, r.stopS, r.alarmS, r.parts, r.speed, age);
    else
      snprintf(b, sizeof b, "{\"machine\":%d,\"event\":\"%s\",\"age_ms\":%lu}", r.machine, r.ev, age);
    if (!mqtt.publish(r.minute ? MQTT_MINUTES : MQTT_EVENTS, b)) return;   // try again next pass
    logHead = (logHead + 1) % LOG_SIZE;
    logCount--;
  }
}

// ======================================================================
// Bluetooth (BLE, Nordic UART)
// ======================================================================
BLECharacteristic* txChar = nullptr;
volatile bool bleConnected = false;
volatile bool bleRestartAdvertising = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; bleRestartAdvertising = true; }
};

void startBLE() {
  BLEDevice::init(BLE_NAME);
  BLEServer* srv = BLEDevice::createServer();
  srv->setCallbacks(new ServerCallbacks());
  BLEService* svc = srv->createService(NUS_SERVICE);
  txChar = svc->createCharacteristic(NUS_TX, BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());
  svc->createCharacteristic(NUS_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE);
  adv->setScanResponse(true);   // the name goes in the scan response
  BLEDevice::startAdvertising();
  Serial.printf("# BLE: advertising as %s\n", BLE_NAME);
}

// a BLE notification carries 20 bytes unless the browser asks for more, so send the line in pieces;
// the pages join them again up to the newline
void bleSendLine(const char* line, int len) {
  for (int i = 0; i < len; i += 20) {
    int k = min(20, len - i);
    txChar->setValue((uint8_t*)(line + i), k);
    txChar->notify();
  }
}

// ======================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("# Smart factory board starting");

  pinMode(LED_PIN, OUTPUT);
  for (int n = 0; n < 4; n++) {
    beginInput(runIn[n], RUN_PIN[n]);
    beginInput(doorIn[n], DOOR_PIN[n]);
  }
  beginInput(alarmIn, ALARM_PIN);
  beginInput(goodIn, GOOD_PIN);
  beginInput(rejIn, REJECT_PIN);
  analogReadResolution(12);
  if (HAVE_POTS) readPots();
  logEvent(0, "boot");                       // a restart shows in the database

  if (USE_WIFI) startWiFi();
  if (USE_WIFI && USE_MQTT) startMQTT();
  if (USE_BLE) startBLE();
  Serial.printf("# free heap %u bytes\n", ESP.getFreeHeap());
}

void loop() {
  static uint32_t lastSample = 0, lastSend = 0, lastTally = millis(), lastSummary = millis();
  static bool pending = true;
  uint32_t now = millis();

  if (USE_WIFI) { server.handleClient(); watchWiFi(); }
  if (USE_WIFI && USE_MQTT) { watchMQTT(); flushLog(); }

  if (bleRestartAdvertising) {               // restart advertising outside the BLE callback
    bleRestartAdvertising = false;
    delay(100);
    BLEDevice::startAdvertising();
  }

  if (readSwitches()) { pending = true; mqttPending = true; }
  if (HAVE_POTS && now - lastSample >= SAMPLE_MS) { lastSample = now; readPots(); }

  tallyMachines(now - lastTally);
  if (workMachines(now - lastTally)) { pending = true; mqttPending = true; }
  lastTally = now;
  if (now - lastSummary >= SUMMARY_MS) { lastSummary = now; writeSummary(); }

  bool due = now - lastSend >= SEND_EVERY_MS;
  if ((pending && now - lastSend >= MIN_GAP_MS) || due) {
    lastSend = now;
    pending = false;
    char line[256];
    int len = makeLine(line, sizeof(line) - 2);
    memcpy(lastLine, line, len + 1);
    Serial.println(line);                   // lines that start with "#" are notes, the pages skip them
    if (USE_WIFI && USE_MQTT) publishMQTT(line);
    if (USE_BLE && bleConnected) {
      line[len] = '\n'; line[len + 1] = '\0';
      bleSendLine(line, len + 1);
    }
  }
}
