# Smart Factory OEE — Group 3

> [!IMPORTANT]
> ## 🔐 วิธี login เข้าเว็บ
>
> 1. เปิดเว็บด้านล่าง จะเจอหน้า login ของ Cloudflare
> 2. ใส่ **Gmail ที่ได้จาก LEB2**: เข้า **LEB2 → EEE 402 Smart Factory → Member → Email** ใช้ email ที่อยู่ในนั้น
> 3. รอรับ **รหัส PIN 6 หลัก** ทาง email นั้น แล้วกรอกรหัสเพื่อ login
>
> ⚠️ **ถ้าเปิดเว็บแล้วไม่ขึ้นหน้า login หรือขึ้น error** น่าจะเป็นเพราะตอนนี้คอมพิวเตอร์ที่เป็น server ไม่ได้เปิดอยู่ (ไม่ใช่ปัญหาที่เครื่องของคุณ)

| เว็บ | ใช้ทำอะไร |
|---|---|
| **OEE dashboard** · https://oee.rdeewv.click | ดูไลน์ผลิตและ OEE แบบสด (ดูอย่างเดียว) |
| **Control** · https://control.rdeewv.click | ควบคุมไลน์ / กด QC / ตั้งกะ / นาฬิกา (login หน้านี้อีกชั้นด้วยรหัส MQTT ครั้งแรก หรือรหัส 5 ตัวจากปุ่ม *Share login* ของเพื่อน) |
| **Grafana** · https://grafana.rdeewv.click | กราฟสัญญาณจากบอร์ด |
| **SQL** · https://sql.rdeewv.click | เปิดดู database (อ่านอย่างเดียว) |
| **Google Sheet** · [เปิด](https://docs.google.com/spreadsheets/d/1ZiESObAtN6erJ4NQateA69M3uQN6uk8AtL6M_rZyW1g/edit?usp=sharing) | สรุป OEE / Events / รายงานประจำวัน |

---

## ภาพรวม

ระบบวัด **OEE (Availability × Performance × Quality)** ของไลน์ผลิต 4 เครื่อง (M1–M4) ผลิตได้ 2 product (A / B) ตามเส้นทางที่เลือก

```
บอร์ด ESP32 ──MQTT──► server (Docker) ──► database ──► หน้าเว็บ OEE / Grafana / Google Sheet / LINE
หน้า control ──────────►    ▲  (ค่าควบคุมอยู่ที่ server ที่เดียว ทุกจอเห็นเหมือนกัน)
```

**สถานะตอนนี้**
- **2 กะ × 12 ชม. = 24 ชม.**: กะ 1 08:00–20:00 (พัก 12:00–13:00) · กะ 2 20:00–08:00 (พัก 00:00–01:00)
- **ข้อมูลจริงมาจากบอร์ดเท่านั้น** ถ้าบอร์ดหลุด ระบบบันทึกเป็น *ไม่ได้บันทึก* พร้อมสาเหตุ (ไม่เอาตัวจำลองมาแทน)
- **นาฬิกาของไลน์** มี 2 โหมด: *เวลาจริง* (เก็บข้อมูลจริง) และ *นาฬิกาจำลอง* (สำหรับทดสอบ เร่งเวลาได้)

## Function หลัก

**หน้า OEE**
- แท็บ **Line**: ภาพ 3D ไลน์ผลิต เครื่องขยับตามความเร็ว / สถานะจริง · กองชิ้นงาน *รอ QC / ดี / เสีย* ของแต่ละ product
- แผง **OEE**: A · P · Q · OEE ของกะปัจจุบัน + แถบเวลาเดิน / หยุด / พัก / ไม่ได้บันทึก (กด ⤢ ดูสาเหตุการหยุดทุกช่วง)
- แท็บ **OEE Dashboard**: OEE แต่ละเครื่อง + ส่วน **จาก database** (เลือก บอร์ด / ไลน์จำลอง / ทดสอบ: OEE 14 วัน, ชิ้นงานต่อชั่วโมง, ช่วงที่ไม่ได้บันทึก)
- ป้ายมุมขวาบนบอกที่มาของข้อมูล: `Live · via board` · `Live · control via website` · `Not recorded · สาเหตุ`

**หน้า Control**
- **Connect board / Disconnect board**: เลือกให้ไลน์ตามบอร์ดจริง หรือใช้หน้านี้เป็นบอร์ดจำลอง
- ตัวจำลอง: RUN / STOP, เปิด-ปิดฝา, Set-up, Maintenance, ความเร็ว 0–200 %, Alarm, พักไลน์, Reset
- **QC ต่อ product**: ✓ GOOD / ✕ REJECT ใส่ **จำนวนชิ้น**ได้ (มือถือขึ้นแป้นตัวเลข) · Undo (เอาออกทั้งก้อน)
- **Products**: เลือกเส้นทาง เช่น `12-34` (A: 01→02 · B: 03→04) + รหัส / ชื่อสินค้า
- **Shift & time frame**: เวลาเริ่มกะ, จำนวนกะ (1–3), ชั่วโมงทำงาน, พัก, ideal cycle
- **นาฬิกาของไลน์**: เวลาจริง / นาฬิกาจำลอง (ดูหัวข้อทดสอบ)
- หลายคนเปิดพร้อมกันได้ ค่าตรงกันทุกเครื่อง · ยอด GOOD / REJECT ตรงกับหน้า OEE ทุกจอ

**อื่นๆ**: Grafana (สัญญาณสด) · SQL (pgweb) · Google Sheet อัปเดตทุก 15 นาที · รายงานประจำวันไป LINE · สำรอง database ทุกวัน

---

## การทดสอบ 2 แบบ

### 🟢 แบบที่ 1: Board (ข้อมูลจริง)

1. เปิดบอร์ด ESP32 (ต่อ Wi-Fi เดียวกับ server)
2. หน้า **Control** → การ์ดนาฬิกา → **เวลาจริง**
3. กด **Connect board** → หัวหน้าต้องขึ้น **VIA BOARD · BOARD CONNECTED**
4. ใช้งานจากบอร์ดจริง (สวิตช์ RUN, ปุ่มฝา, ปุ่มหมุนความเร็ว, ALARM, GOOD / REJECT) หน้า OEE ทุกจอเปลี่ยนตาม

- ข้อมูลบันทึกลง database เป็น `source = board` · ดูได้ที่ OEE Dashboard → จาก database → **บอร์ด**, Google Sheet, Grafana
- **ถ้าบอร์ดหลุด**: หน้า control ขึ้น `WAITING FOR BOARD · NOT RECORDED` · หน้า OEE ขึ้น `Not recorded · สาเหตุ` (บอร์ดออฟไลน์ / ไม่ส่งข้อมูล / ยังไม่เคยต่อ) · ช่วงนั้นถูกบันทึกเป็น *ไม่ได้บันทึก* ไม่นับใน OEE

### 🟣 แบบที่ 2: Simulation (ไม่มีบอร์ด)

**2a. เล่น / สาธิต (ไม่บันทึก)**: หน้า Control กด **Disconnect board** → ใช้ปุ่มตัวจำลองคุมไลน์ หน้า OEE ทุกจอทำตาม (`Live · control via website`) · ไม่บันทึกลง database

**2b. ทดสอบแบบบันทึกผล (นาฬิกาจำลอง)**
1. หน้า Control → **Disconnect board** → การ์ดนาฬิกา → **นาฬิกาจำลอง**
2. เลือกเวลา (หรือปุ่มลัด: *ต้นกะ*, *5 นาทีก่อนพัก*, *5 นาทีก่อนจบกะ*, *+1 ชม.*, *ต้นกะถัดไป*) และความเร็ว **1× / 10× / 60×** (60× = 1 วินาทีเท่ากับ 1 นาที) · หยุดเวลาได้
3. คุมไลน์ / กด GOOD / REJECT ตาม test case
4. ดูผล: OEE Dashboard → จาก database → **ทดสอบ** (วันตามนาฬิกาจำลอง)
5. เสร็จแล้วกลับเป็น **เวลาจริง**

- ข้อมูลทดสอบบันทึกเป็น `source = test` ที่เวลาจำลอง **แยกจากข้อมูลจริง** · ระหว่างทดสอบข้อมูลจริงหยุดบันทึก
- ลบข้อมูลทดสอบ (บนเครื่อง server): `docker compose exec timescaledb psql -U factory_admin -d factory -c "DELETE FROM minutes WHERE source='test'" -c "DELETE FROM events WHERE source='test'"`

---

## เอกสารเพิ่มเติม

- [`README-full.md`](README-full.md): คู่มือฉบับเต็ม (ติดตั้งบนเครื่องใหม่, Google Sheet / LINE, Cloudflare, แก้ปัญหา, ความปลอดภัย)
- [`OEE-System/README.md`](OEE-System/README.md): รายละเอียดเชิงเทคนิค (database, สูตร OEE, MQTT, บอร์ด ESP32)
- [`OEE-System/website/wiring-map.html`](OEE-System/website/wiring-map.html): แผนผังการต่อสายบอร์ด

> หมายเหตุ: เครื่องจักรบนหน้าเว็บเป็น demo ไม่ใช่เครื่องจริง
