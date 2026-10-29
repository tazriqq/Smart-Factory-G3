// secrets.example.h - template for secrets.h (this file is safe to upload to GitHub).
// Copy it to secrets.h in this folder and fill in your own values; secrets.h stays on your computer.
#pragma once

// Wi-Fi (2.4 GHz)
#define SECRET_WIFI_SSID      "YOUR_WIFI_NAME"
#define SECRET_WIFI_PASS      "YOUR_WIFI_PASSWORD"

// MQTT: the Mosquitto broker on the server computer (server/docker-compose.yml), plain MQTT inside the Wi-Fi.
//       HOST = that computer's IP; PASS = MQTT_ESP32_PASS in server/.env
#define SECRET_MQTT_HOST      "192.168.1.107"
#define SECRET_MQTT_PORT      1883
#define SECRET_MQTT_TLS       false
#define SECRET_MQTT_USER      "esp32"
#define SECRET_MQTT_PASS      "MQTT_ESP32_PASS from server/.env"

