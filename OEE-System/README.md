# Smart Factory OEE System (คู่มือติดตั้ง)

```
                    เครื่อง server (คอม / Raspberry Pi ที่เปิดทิ้งไว้) ── docker compose
                    ┌───────────────────────────────────────────────────────────────────────────────┐
ESP32 ──MQTT:1883──►│ Mosquitto ──┬── nginx :8080 ──► หน้าเว็บ  OEE (/mqtt-view) · control (/mqtt)       │
                    │             ├──► control-hub ──► Mosquitto (ค่าควบคุมจริงของหน้า control ที่เดียว)      │
                    │             └──► Telegraf ──┬──► PostgreSQL/TimescaleDB :5432 ◄── Claude (MCP)       │ ← ที่เก็บหลัก
                    │                             │        ├──► backup (ไฟล์ .dump ทุกวัน)                │
                    │                             │        └──► pgweb :8081 (ดูในเว็บ, อ่านอย่างเดียว)       │
                    │                             └──► InfluxDB ──► Grafana :3000                       │
                    │  sheets-sync: อ่านสรุปจาก PostgreSQL ──HTTPS──┐  (+ รายงานประจำวันไป LINE)          │
                    └───────────────────────────────────────────────│───────────────────────────────┘
                                    Google Sheet (สรุป OEE) ◄────────┘ ──► Claude บน claude.ai
```
- **PostgreSQL คือที่เก็บข้อมูลหลัก** — ทุกสัญญาณ ทุก event ทุกนาที + คำนวณ OEE ใน database (view `oee_daily`, `oee_hourly`, function `oee()`)
- **Google Sheet เก็บแค่สรุป** (OEE รายวัน / รายชั่วโมง, Events, Products, Daily_Report) ที่ server ส่งขึ้นไปให้ — แก้ในชีตไม่มีผล
- ESP32 ส่งทุกอย่างผ่าน MQTT **ในวง Wi-Fi เดียวกัน** (ไม่ต้องใช้อินเทอร์เน็ต) — ที่ต้องใช้อินเทอร์เน็ตมีแค่ sheets-sync (ชีต + LINE) และ Cloudflare Tunnel (เปิดจากข้างนอก)
- เครื่อง server ตอนนี้คือ `192.168.1.107`

ไฟล์ในโฟลเดอร์นี้
```
OEE-System/
├── README.md                                  ← คู่มือนี้
├── .gitignore                                 ← กันไม่ให้ secrets.h, .env และ .mcp.json ขึ้น GitHub
├── .mcp.json                                  ← 🔒 ให้ Claude Code อ่าน database (ไม่ขึ้น GitHub)
├── .mcp.example.json                          ← แม่แบบของ .mcp.json
├── website/                                   ← หน้าเว็บ (server เปิดให้ที่ :8080 หรือเปิด index.html ตรงๆ)
│   ├── index.html                             ← โครงหน้า แบ่ง ZONE 1-4 ด้วย comment
│   ├── css/                                   ← หน้าตา (เลขหน้าไฟล์ = ลำดับโหลด ห้ามสลับ)
│   └── js/                                    ← การทำงาน (เลขหน้าไฟล์ = ลำดับโหลด) · js/vendor = MQTT library
├── esp32/
│   └── SmartFactoryBoard_MQTT/
│       ├── SmartFactoryBoard_MQTT.ino         ← โค้ด ESP32 (เปิดด้วย Arduino IDE)
│       ├── secrets.h                          ← 🔒 Wi-Fi / MQTT รหัสจริง (ไม่ขึ้น GitHub)
│       └── secrets.example.h                  ← แม่แบบของ secrets.h
├── google-sheets/
│   └── sheets_webapp.gs                       ← โค้ด Google Apps Script (รับสรุปจาก server มาเขียนลงชีต)
└── server/                                    ← ทุกอย่างที่รันบนเครื่อง server (Docker)
    ├── docker-compose.yml                     ← 10 service: mosquitto, web (nginx), timescaledb, influxdb, telegraf, grafana,
    │                                             sheets-sync, control-hub, backup, pgweb (+ cloudflared ถ้าใช้ --profile tunnel)
    ├── .env                                   ← 🔒 รหัสผ่านทั้งหมด (สุ่มไว้แล้ว, ไม่ขึ้น GitHub)
    ├── .env.example                           ← แม่แบบของ .env
    ├── mosquitto/                             ← ตั้งค่า broker + สิทธิ์ผู้ใช้ (acl, acl_view)
    ├── nginx/default.conf                     ← หน้าเว็บ + ส่งต่อ /mqtt, /mqtt-view, /pair · เลือกหน้า OEE / control ตามชื่อ domain
    ├── control-hub/hub.py                     ← ค่าควบคุมจริงของหน้า control + รหัสจับคู่ 5 ตัว
    ├── postgres/schema.sql                    ← ตาราง, view OEE, ผู้ใช้ (สร้างตอนเปิดครั้งแรก)
    ├── postgres/init.sh                       ← รัน schema.sql พร้อมรหัสจาก .env
    ├── sheets-sync/sync.py                    ← ส่งสรุปจาก database ขึ้น Google Sheet + รายงานประจำวันไป LINE
    ├── telegraf/telegraf.conf                 ← รับ MQTT แล้วเขียนลง PostgreSQL + InfluxDB
    ├── telegraf/watchdog.sh                   ← รีสตาร์ต Telegraf เองเมื่อข้อมูลบอร์ดไม่เข้า
    ├── grafana/                               ← เชื่อม InfluxDB + dashboard "Smart Factory · Line 1"
    └── backups/                               ← 🔒 ไฟล์สำรอง database รายวัน (ไม่ขึ้น GitHub)
```
(Arduino IDE ต้องการให้ไฟล์ `.ino` อยู่ในโฟลเดอร์ชื่อเดียวกัน จึงมีโฟลเดอร์ `SmartFactoryBoard_MQTT` ซ้อนอยู่)

### หน้าเว็บแบ่งเป็นโซน
| โซน | ส่วนของหน้า | CSS | JavaScript |
|---|---|---|---|
| ทั้งหน้า | ธีมสี, layout | `01-theme.css`, `02-layout-dashboard.css` | `01-machine-sandbox.js`, `02-theme.js` |
| **ZONE 1** | แถบบน: ชื่อ + เชื่อมบอร์ด (Bluetooth / USB / Wi-Fi / **MQTT**) | (อยู่ใน `02-layout-dashboard.css`) | `05-zone1-board-connection.js` |
| **ZONE 2** | แผงซ้าย (ซ่อนไว้ ปุ่มย้ายไปหน้า `control.html` แล้ว แต่ยังรับค่าจากหน้า control): ปุ่มหมุนความเร็ว M1-M4 + บอร์ดไลน์ (alarm, Good / Reject) | `10-zone2-knobs.css`, `11-zone2-control-panel.css` | `04-zone2-control-panel.js` (+ ปุ่มหมุนใน `05-…`) |
| **ZONE 3** | ไลน์ผลิต: เครื่อง 4 เครื่องบนพื้นโรงงาน, สายพาน, สถิติไลน์ | `08-zone3-factory-line.css`, `09-zone3-cnc-stage.css` | `03-zone3-line-stage.js`, `15-zone3-factory-line.js` |
| เครื่องจักร | ภาพวาด + animation ของแต่ละเครื่อง | `04-machine-lnc8.css` … `07-machines-on-line.css` | `07`-`14-machine-*.js` |
| **ZONE 4** | แผง OEE: A × P × Q, กะ, timeline | `03-zone4-oee.css` | `06-zone4-oee.js` |

- **ลำดับไฟล์สำคัญ** เลขหน้าชื่อไฟล์คือลำดับที่ `index.html` โหลด ถ้าสลับ หน้าตาหรือการทำงานอาจเพี้ยน
- `index.html` ใหญ่ (~3 MB) เพราะภาพวาดเครื่องจักรเป็น SVG ที่ JavaScript ต้องขยับได้

---

## 1. เครื่อง server (docker compose)
1. ติดตั้ง Docker (Linux / Docker Desktop / Raspberry Pi 4-5 OS 64-bit)
2. `cd server` → ถ้ายังไม่มี `.env`: `cp .env.example .env` แล้วตั้งรหัสผ่านทุกช่อง
   (เครื่องนี้มี `.env` ที่สุ่มรหัสไว้แล้ว และตั้ง `INFLUX_PORT=8087` เพราะ InfluxDB ตัวเดิมใช้ 8086 อยู่)
3. `docker compose up -d --build` → `docker compose ps` ต้องขึ้นครบ 10 ตัว
4. เปิดใช้ได้จากทุกเครื่องใน Wi-Fi เดียวกัน (pgweb เปิดได้เฉพาะบนเครื่อง server)

| อะไร | ที่อยู่ | login |
|---|---|---|
| หน้าเว็บ OEE / control | `http://192.168.1.107:8080` · `/control.html` | OEE ไม่ต้อง login · control: MQTT user `web` + `MQTT_WEB_PASS` |
| Grafana | `http://192.168.1.107:3000` | `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` ใน `.env` |
| MQTT (ESP32) | `192.168.1.107:1883` | user `esp32` + `MQTT_ESP32_PASS` |
| MQTT WebSocket | `ws://192.168.1.107:8080/mqtt` (nginx → Mosquitto 9001, ซึ่งเปิดเฉพาะบนเครื่อง server) | user `web` |
| PostgreSQL | `192.168.1.107:5432` database `factory` | `reader` + `PG_READER_PASS` (อ่านอย่างเดียว) · `factory_admin` + `PG_ADMIN_PASSWORD` (แก้ได้ทุกอย่าง) |
| pgweb (database ในเว็บ) | `http://127.0.0.1:8081` (บนเครื่อง server เท่านั้น) · จากข้างนอก `https://sql.rdeewv.click` | ไม่ต้อง login (ข้างนอกผ่าน Cloudflare Access) · ล็อกเป็น `reader` + read only |

**ผู้ใช้ MQTT** (สร้างจาก `.env` ทุกครั้งที่เปิด, สิทธิ์ใน `server/mosquitto/acl`)
- `esp32` — ส่งข้อมูลได้ (บอร์ด)
- `web` — อ่านทุก topic ของไลน์ (หน้า control, Telegraf) และเขียนได้เฉพาะคำสั่ง: `…/route/set`, `…/control/set`, `…/control/pair` → ถ้ารหัสนี้หลุด คนอื่นสั่งไลน์จำลองได้ แต่ปลอมข้อมูลบอร์ดหรือเขียน database ไม่ได้
- `hub` — control-hub: เขียนค่าควบคุมจริง (`…/control`) และบันทึกการกดบนเว็บเป็น event `source = website`
- ไม่มีรหัส = เข้าได้เฉพาะช่องอ่านอย่างเดียว (listener 9002, `acl_view`) ที่หน้า OEE ใช้ผ่าน `/mqtt-view`

**⚠ ล็อก IP ของเครื่อง server** — ตอนนี้ได้ IP จาก DHCP (`192.168.1.107`) ถ้าเปลี่ยน ESP32 จะหา broker ไม่เจอ
→ เข้าหน้าเราเตอร์ (ปกติ `http://192.168.1.1`) → DHCP → **Address Reservation / Static Lease** → จอง `192.168.1.107` ให้เครื่องนี้
(ถ้า IP เปลี่ยน: แก้ `SECRET_MQTT_HOST` ใน `secrets.h` แล้วอัปโหลดบอร์ดใหม่ — หน้าเว็บที่เปิดผ่าน `:8080` ปรับตามเองอัตโนมัติ)

## 2. Google Sheet (เก็บสรุป)
1. สร้าง Google Sheet ใหม่ ตั้งชื่อเช่น `DPX OEE Log` (ใช้ชีตเดิมก็ได้)
2. เมนู **Extensions → Apps Script** → ลบโค้ดเดิม วางทั้งไฟล์ `google-sheets/sheets_webapp.gs`
3. Save → ⚙ **Project Settings** → **Script properties** → Property `KEY` = รหัสเดียวกับ `SHEETS_KEY` ใน `server/.env`
4. เลือกฟังก์ชัน **setup** → **Run** → อนุญาตสิทธิ์ → ได้แท็บ `Events`, `OEE_Daily`, `OEE_Hourly`, `Products`, `Daily_Report`, `Machines`, `Notes`
   (แท็บเก่า `Minute`, `Settings` ไม่ใช้แล้ว ลบทิ้งได้ · แท็บ `Events` เก่าจะถูกเขียนทับด้วยรูปแบบใหม่เอง)
5. Deploy
   - ครั้งแรก: **Deploy → New deployment → Web app** — Execute as: **Me** · Who has access: **Anyone** → คัดลอก URL (`/exec`) ใส่ `SHEETS_URL` ใน `server/.env`
   - เคย deploy แล้ว: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (URL เดิม)
6. `cd server && docker compose up -d sheets-sync` → `docker compose logs sheets-sync` ควรเห็น `sheets-sync: … ok N rows`

- server ส่ง **ทุก 15 นาที** (`SHEETS_EVERY_MIN`, แท็บ Events ภายใน ~10 วินาทีหลังมี event) และเขียนทับทั้งแท็บ → ชีตตรงกับ database เสมอ, ไม่มีวันเต็ม
- รายงานประจำวันไป LINE (`REPORT_AT`, `LINE_CHANNEL_TOKEN`): วิธีตั้งค่าอยู่ใน [`README.md`](../README.md) ข้อ 6
- ไม่ใส่ `SHEETS_URL` = ปิดการส่งขึ้นชีต (database ยังทำงานปกติ)

## 3. บอร์ด ESP32 (`esp32/SmartFactoryBoard_MQTT/secrets.h`)
รหัสทั้งหมดอยู่ใน `secrets.h` ไฟล์เดียว (ไม่ต้องแก้ `.ino`) — เครื่องใหม่ / clone จาก GitHub: copy `secrets.example.h` เป็น `secrets.h` แล้วกรอก
```cpp
#define SECRET_WIFI_SSID      "ชื่อ Wi-Fi"
#define SECRET_WIFI_PASS      "รหัส Wi-Fi"

#define SECRET_MQTT_HOST      "192.168.1.107"            // IP เครื่อง server
#define SECRET_MQTT_PORT      1883
#define SECRET_MQTT_TLS       false
#define SECRET_MQTT_USER      "esp32"
#define SECRET_MQTT_PASS      "MQTT_ESP32_PASS ใน server/.env"   // เครื่องนี้ใส่ไว้ให้แล้ว
```
(บอร์ดไม่ส่งไป Google แล้ว — `SECRET_SHEETS_URL` / `KEY` ใน `secrets.h` เก่าไม่ได้ใช้ ลบได้)
- Library Manager: ติดตั้ง **PubSubClient** (by Nick O'Leary)
- Board **ESP32 Dev Module**, Partition Scheme **Huge APP (3MB No OTA/1MB SPIFFS)** → Upload
- **Bluetooth เปิดได้แล้ว** (`USE_BLE = true`) เพราะบอร์ดไม่ต้องทำ HTTPS ไป Google
- **ปุ่มบนบอร์ด:** ปุ่ม 6×6 ขา 23 / 19 / 18 / 17 = **เปิด / ปิดฝา** เครื่อง M1–M4 (ฝาเปิด = เครื่องหยุด) · ขา 16 = **GOOD**, ขา 4 = **REJECT** (ย้ายกล่องจากกอง 1 ไปกองดี / กองเสียบนหน้าเว็บ)
- **บอร์ดผลิตชิ้นงานเอง:** เครื่องที่เดินอยู่ (run ติด, ไม่มี alarm, ฝาปิด, ความเร็ว > 0 %) ทำเสร็จ 1 ชิ้นทุก cycle (M1 18 s · M2 30 s · M3 24 s · M4 36 s ที่ 100 %) แล้วส่งต่อเครื่องถัดไปในเส้นทางของ product นั้น ชิ้นจากเครื่องสุดท้ายของเส้นทางคือ output — `ideal_cycle_s` ในตาราง `machines` ต้องตรงกับค่านี้ (`CYCLE_MS` ใน `.ino`)
- **2 product (เส้นทางผลิต):** บอร์ดเก็บเส้นทางเป็นข้อความ เช่น `12-34` = product A ผ่าน M1 → M2, product B ผ่าน M3 → M4 (`1234-` = product เดียวผ่านทั้ง 4 เครื่อง, เครื่องที่ไม่อยู่ในเส้นทางไหน = idle) · 1 เครื่องอยู่ได้ product เดียว · จำไว้ใน flash แม้ปิดเครื่อง · เปลี่ยนเส้นทางแล้วชิ้นงานค้างหายไป
  - ตั้งจากหน้า control (การ์ด **Products**) — หรือพิมพ์ `route 12-34` ใน Serial Monitor · `POST http://192.168.1.200/route` body `12-34` · MQTT publish `12-34` ไป `group3/dpx/line1/route/set`
  - ปุ่ม GOOD / REJECT นับให้ product ที่มีชิ้นงานออกจากไลน์ล่าสุด
- บอร์ดส่ง 3 topic: `…/board` (สัญญาณสด + `route`, `out`, `qg`, `qr` ของแต่ละ product), `…/events` (กดปุ่ม / สวิตช์ / ผลิตเสร็จ พร้อม `product`), `…/minutes` (สรุปทุก 1 นาที / เครื่อง พร้อม `product`) และฟัง `…/route/set` (user `web` เขียนได้เฉพาะ topic นี้)
  ถ้า MQTT หลุด แถว events / minutes รอในบอร์ด (600 แถว ≈ 2 ชั่วโมง) แล้วส่งตามเมื่อต่อได้ — เวลาถูกต้องเพราะบอร์ดบอกว่ารอไปนานเท่าไร (`age_ms`) ไม่ต้องใช้นาฬิกาจากอินเทอร์เน็ต
- Serial Monitor 115200 ควรเห็น
  `# Wi-Fi: connected` → `# MQTT: connected, publishing to group3/dpx/line1/board`

| Serial Monitor | แปลว่า | แก้ |
|---|---|---|
| `MQTT: failed (state -2 …)` | ต่อ server ไม่ได้ | server เปิดอยู่ไหม (`docker compose ps`), IP ถูกไหม, อยู่ Wi-Fi เดียวกันไหม |
| `MQTT: failed (state 4 …)` | รหัสผิด | `SECRET_MQTT_PASS` ต้องตรงกับ `MQTT_ESP32_PASS` ใน `server/.env` |
| `MQTT: failed (state 5 …)` | ไม่มีสิทธิ์ | user ต้องเป็น `esp32` |
| `Log: buffer full, oldest row dropped` | MQTT หลุดนานเกิน ~2 ชม. | ตรวจ server / Wi-Fi |

## 4. หน้าเว็บ
- **OEE** `http://192.168.1.107:8080` แสดงผลอย่างเดียว ไม่ต้อง login (MQTT ช่องอ่านอย่างเดียวที่ `/mqtt-view`)
- **Control** `http://192.168.1.107:8080/control.html` login ด้วย user `web` + `MQTT_WEB_PASS` ครั้งแรก (หรือรหัสจับคู่ 5 ตัวจากเครื่องที่ login แล้ว) · ค่าควบคุมจริงอยู่ที่ `control-hub`
- วิธีใช้ทั้งหมด: [`README.md`](../README.md) ข้อ 3–5

## 5. ให้ Claude วิเคราะห์
### ทางหลัก: Claude อ่าน database ผ่าน MCP (ละเอียดที่สุด)
ใช้ [Postgres MCP Pro](https://github.com/crystaldba/postgres-mcp) โหมด `restricted` (อ่านอย่างเดียว) ล็อกอินเป็น user `reader`
- **Claude Code บนเครื่อง server:** เปิด `claude` ในโฟลเดอร์ `OEE-System` → ไฟล์ `.mcp.json` ตั้งไว้แล้ว → ตอบ **Yes** ให้ใช้ server `oee-db` → `/mcp` ต้องขึ้น connected
- **Claude Code ใช้ได้ทุกโฟลเดอร์** (ทำครั้งเดียว):
  ```bash
  claude mcp add oee-db --scope user -e DATABASE_URI="postgresql://reader:<PG_READER_PASS>@192.168.1.107:5432/factory" \
    -- docker run -i --rm --network host -e DATABASE_URI crystaldba/postgres-mcp:0.3.0 --access-mode=restricted
  ```
- **Claude Desktop / เครื่องอื่นใน Wi-Fi เดียวกัน:** ใช้ค่าเดียวกับ `.mcp.example.json` (เปลี่ยน `localhost` เป็น `192.168.1.107`) ใส่ใน Settings → Developer → Edit Config
- ถามเช่น
  > ดู database oee-db: สรุป OEE ของแต่ละเครื่องเมื่อวาน เครื่องไหนเป็นคอขวด เสียเวลาไปกับ alarm หรือหยุดเครื่องเท่าไร ช่วงไหนของวัน และควรปรับอะไร

  Claude อ่านคำอธิบายของทุกตาราง / view จาก database เอง (`COMMENT ON` ใน `schema.sql`) แล้วเขียน SQL เอง

### ทางสำรอง: claude.ai อ่าน Google Sheet
เปิด Claude ที่เชื่อม Google Drive แล้วถาม เช่น
> อ่าน Google Sheet "DPX OEE Log" (แท็บ Notes อธิบายแต่ละแท็บ) แล้วสรุป OEE สัปดาห์นี้ และเครื่องไหนเป็นคอขวด

(ชีตมีแค่สรุปรายวัน / รายชั่วโมง — คำถามละเอียดระดับ event ให้ใช้ทาง MCP)

---

## ข้อมูลที่บันทึก
### PostgreSQL / TimescaleDB (ที่เก็บหลัก, database `factory`)
| ชื่อ | ชนิด | 1 แถว = | เก็บ |
|---|---|---|---|
| `events` | ตาราง | 1 สัญญาณ: `machine` (0 = ทั้งไลน์), `event` = part, output, run_on/off, door_open/close, alarm_on/off, good, reject, boot, route · จากหน้า control เพิ่ม setup_on/off, maintenance_on/off, product_info, oee_clear, use_board / use_simulator · `product` = A / B · `route` (เฉพาะ event route) · `source` = board / website | ตลอดไป |
| `minutes` | ตาราง | 1 เครื่อง / 1 นาที: `product`, `run_s`, `stop_s`, `alarm_s`, `parts`, `speed_pct` | ตลอดไป |
| `board` | ตาราง | ข้อความสดจากบอร์ด (~1 ครั้ง/วินาที) `pot_0..3 run_0..3 door_0..3 al cnt_0..3 good rej ms` | 365 วัน (บีบอัดหลัง 7 วัน) |
| `board_status` | ตาราง | online / offline ของบอร์ด | ตลอดไป |
| `machines` | ตาราง (ตั้งค่า) | ชื่อเครื่อง + `ideal_cycle_s` | — |
| `oee_daily` | view | OEE 1 เครื่อง (+ product ที่ทำ) / 1 วัน (วันที่ไทย) | คำนวณสดทุกครั้ง |
| `product_daily` | view | 1 product / 1 วัน: `output`, `good`, `reject`, `quality` | คำนวณสดทุกครั้ง |
| `route_history` | view | ทุกครั้งที่เปลี่ยนเส้นทาง: เวลา + เครื่องของ A / B | — |
| `product_info` | view | รหัส + ชื่อสินค้าล่าสุดของ A / B (ตั้งในหน้า control) | — |
| `oee_hourly` | view | OEE 1 เครื่อง / 1 ชั่วโมง ย้อนหลัง 30 วัน | คำนวณสดทุกครั้ง |
| `oee(bucket, since, until, bucket_offset)` | function | OEE ช่วงเวลาใดก็ได้ เช่น กะ 08-20 / 20-08: `oee('12 hours', bucket_offset => '8 hours')` | — |
| `line_status` | view | บอร์ด online ไหม + ข้อมูลล่าสุดเข้ามาเมื่อไร | — |

- **Availability** = เวลาเดินเครื่อง ÷ เวลาที่บอร์ดเปิดบันทึก
- **Performance** = ideal_cycle_s × จำนวนชิ้น ÷ เวลาเดินเครื่อง
- **Quality** = good ÷ (good + reject) ของ **product ที่เครื่องนั้นทำ** — เครื่องในเส้นทางเดียวกันจึงได้ค่าเท่ากัน (ข้อมูลก่อนมี product นับรวมทั้งไลน์เหมือนเดิม)
- **แก้ ideal_cycle_s** (ทุกวันย้อนหลังคำนวณใหม่เองทันที):
  ```bash
  docker compose exec timescaledb psql -U factory_admin -d factory -c "UPDATE machines SET ideal_cycle_s = 55 WHERE line = 'line1' AND machine = 1"
  ```
- เปิดดูเอง: `docker compose exec timescaledb psql -U factory_admin -d factory` แล้ว `SELECT * FROM oee_daily ORDER BY day DESC LIMIT 20;`
- แก้ `schema.sql` แล้ว: `docker compose exec timescaledb sh /docker-entrypoint-initdb.d/init.sh` (รันซ้ำได้ ไม่ลบข้อมูล)

### Google Sheet (สรุป, server เขียนทับทุก 15 นาที)
ทุกแท็บมีไม่เกิน `SHEETS_MAX_ROWS` แถว (ค่าเริ่มต้น 1000 ใน `server/.env`) — เก็บแถวใหม่สุด ของเก่าหลุดออก (first in, first out) ชีตจึงเล็กตลอด (ไม่ถึง 1 MB) ข้อมูลทั้งหมดยังอยู่ใน database
| แท็บ | มาจาก |
|---|---|
| Events | กดปุ่ม / สวิตช์ 500 ครั้งล่าสุด (ใหม่สุดอยู่บน) · คอลัมน์ `source` = `board` (กดบนบอร์ด) หรือ `website` (กดบนหน้า control; OEE คิดจากบอร์ดอย่างเดียว) — ขึ้นชีตภายใน ~10 วินาทีหลังกด (`SHEETS_EVENTS_ROWS`, `SHEETS_EVENTS_GAP_S`) |
| OEE_Daily | view `oee_daily` ทั้งหมด |
| OEE_Hourly | `oee('1 hour')` ย้อนหลัง 14 วัน (`SHEETS_HOURLY_DAYS`) |
| Products | view `product_daily` ทั้งหมด พร้อมรหัส / ชื่อสินค้า |
| Daily_Report | สรุปประจำวันสำหรับผู้บริหาร 1 แถวต่อวัน (ข้อความเดียวกับที่ส่ง LINE) |
| Machines | ตาราง `machines` |
| Notes | คำอธิบายแต่ละแท็บ + เวลาอัปเดตล่าสุด |

### InfluxDB + Grafana (ละเอียด ทุกข้อความ)
| Panel | แสดง |
|---|---|
| Board / Last data | บอร์ด online/offline (broker แจ้งเองเมื่อบอร์ดหลุด) + ข้อมูลล่าสุดเมื่อไร |
| Parts made / Good / Reject / Quality | ยอดรวมในช่วงเวลาที่เลือก (มุมขวาบน) |
| Machine state | แถบเวลาแต่ละเครื่อง: Running 🟩 Stopped 🟥 Alarm 🟧 No data ⬜ |
| Run ratio (A) | สัดส่วนเวลาที่เครื่องเดิน (= A ของ OEE เทียบกับเวลาที่บอร์ดเปิด) |
| Parts per interval | จำนวนชิ้นต่อช่วงเวลา แยกเครื่อง |
| Speed setting | ความเร็วจากปุ่มหมุน 0-200 % |

- InfluxDB: measurement `board` ฟิลด์ `pot_0..3 run_0..3 door_0..3 al cnt_0..3 good rej ms` (เครื่อง 1 = `_0`) และ `board_status` · เก็บ 365 วัน (`INFLUX_RETENTION`) — ใช้แค่ให้ Grafana แสดงสด, ข้อมูลหลักอยู่ใน PostgreSQL

## คำสั่งที่ใช้บ่อย (ใน `server/`)
```bash
docker compose ps                    # สถานะทุกตัว
docker compose logs -f mosquitto     # ใครต่อเข้ามา / รหัสผิด (Ctrl+C ออก)
docker compose logs -f telegraf      # MQTT → PostgreSQL / InfluxDB มีปัญหาไหม
docker compose logs sheets-sync      # ส่งสรุปขึ้น Google Sheet สำเร็จไหม
docker compose exec mosquitto mosquitto_sub -u web -P "$(grep ^MQTT_WEB_PASS= .env | cut -d= -f2)" -t 'group3/dpx/#' -v   # ดูข้อความจากบอร์ดสดๆ
docker compose restart               # รีสตาร์ททุกตัว
docker compose down                  # หยุด (ข้อมูลยังอยู่) · down -v = ลบข้อมูลทั้งหมด
```
แก้รหัส MQTT ใน `.env` แล้ว → `docker compose up -d` (Mosquitto สร้างรหัสใหม่เอง) และแก้ `secrets.h` ของบอร์ดให้ตรง

## สำรอง / restore database
service `backup` สร้าง `server/backups/factory-YYYY-MM-DD.dump` ทุกวัน (ตอนเปิดและทุก 24 ชั่วโมง ถ้าไม่สำเร็จลองใหม่ทุก 5 นาที) เก็บ `BACKUP_KEEP_DAYS` วัน · ไฟล์นี้กับ `.env` ไม่ขึ้น GitHub ให้คัดลอกไปเก็บนอกเครื่องเอง

**restore** (ในโฟลเดอร์ `server/`, เครื่องใหม่ให้ `docker compose up -d` ครั้งแรกก่อน เพื่อสร้างผู้ใช้ database):
```bash
docker compose stop telegraf sheets-sync backup pgweb             # ไม่ให้มีใครเขียน / ต่อ database ระหว่าง restore
P() { docker compose exec -T timescaledb "$@"; }
P psql -U factory_admin -d postgres -c "DROP DATABASE factory" -c "CREATE DATABASE factory"
P psql -U factory_admin -d factory -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()"
P pg_restore -U factory_admin -d factory < backups/factory-YYYY-MM-DD.dump  # ข้อความเตือนเรื่อง circular / hypertable ไม่เป็นไร
P psql -U factory_admin -d factory -c "SELECT timescaledb_post_restore()"
docker compose up -d
```
แล้วเช็ก: `P psql -U factory_admin -d factory -c "SELECT count(*) FROM events"`

## ขึ้น GitHub
repo: https://github.com/tazriqq/Smart-Factory-G3 · วิธี clone ไปใช้บนเครื่องใหม่ดูที่ [`README.md`](../README.md) นอกสุด
- `.gitignore` กัน `secrets.h`, `server/.env`, `.mcp.json` และ `server/backups/` ไว้แล้ว — ก่อน push ให้ดู `git status` ทุกครั้ง
- รหัส MQTT ของหน้าเว็บไม่ได้อยู่ในโค้ด — ผู้ใช้พิมพ์เอง และจำไว้ในเบราว์เซอร์ของเครื่องนั้นเท่านั้น
