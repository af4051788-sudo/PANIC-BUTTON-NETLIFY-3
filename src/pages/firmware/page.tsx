import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft, Copy, Check, Cpu, Zap, Wifi, AlertTriangle,
  ChevronDown, ChevronUp, Terminal, BookOpen, Download,
} from "lucide-react";

export type BoardType = "wemosd1" | "nodemcu" | "esp01" | "esp32c3";

function generateFirmware(deviceId: string, pairingCode: string, deviceType: "personal" | "community" = "personal", board: BoardType = "wemosd1"): string {
  if (board === "nodemcu") return generateNodeMcuFirmware(deviceId, pairingCode, deviceType);
  if (board === "esp01") return generateEsp01Firmware(deviceId, pairingCode, deviceType);
  if (board === "esp32c3") return generateEsp32C3Firmware(deviceId, pairingCode, deviceType);
  return generateWemosFirmware(deviceId, pairingCode, deviceType);
}

// Wemos D1 Mini (ESP8266) — logika alarm (tombol/buzzer/LED/server) TIDAK
// DIUBAH dari versi asli. Yang ditambahkan CUMA lapisan konfigurasi: WiFi +
// alamat server sekarang disimpan di EEPROM dan bisa diganti dari HP lewat
// portal konfigurasi (device jadi hotspot sementara), tidak perlu reflash
// tiap kali pindah WiFi atau pindah mode Lokal/Internet. Nilai yang di-inject
// generator ini (DEFAULT_*) cuma dipakai SEKALI sebagai isian awal — begitu
// device pernah dikonfigurasi/disimpan, EEPROM yang jadi acuan seterusnya.
function generateWemosFirmware(deviceId: string, pairingCode: string, deviceType: "personal" | "community"): string {
  const alarmOnPath = deviceType === "community" ? "/wemos/community/alarm/on" : "/wemos/alarm/on";
  const alarmOffPath = deviceType === "community" ? "/wemos/community/alarm/off" : "/wemos/alarm/off";
  return `/*
 * PANIC BUTTON - Firmware Wemos D1 Mini (ESP8266)
 * Mode: ${deviceType === "community" ? "COMMUNITY (Pos Satpam/Kantor RT-RW/Fasum)" : "PERSONAL (device pribadi)"}
 *
 * WiFi & alamat server TIDAK perlu diedit di sini kalau tidak mau — nilai di
 * bawah cuma "isian awal" saat pertama kali setup. Cara mengisi/mengganti
 * WiFi & server TANPA reflash:
 *   1. Device pertama kali nyala (atau tekan & TAHAN tombol PANIC ±3 detik
 *      saat device sudah menyala) → device jadi hotspot WiFi bernama
 *      "PanicButton-Setup" (password: setup1234).
 *   2. Dari HP, connect ke hotspot itu, buka browser ke 192.168.4.1.
 *   3. Isi WiFi, Server URL/Host, Device ID, Pairing Code → Simpan.
 *   4. Device restart otomatis & langsung pakai pengaturan baru.
 * Kalau mau isi manual lewat kode (opsional, cuma jadi default awal):
 * ganti DEFAULT_WIFI_SSID, DEFAULT_WIFI_PASSWORD, DEFAULT_SERVER_URL, dst.
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

const char* DEFAULT_WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* DEFAULT_WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* DEFAULT_DEVICE_ID     = "${deviceId}";
const char* DEFAULT_PAIRING_CODE  = "${pairingCode}";
const char* DEFAULT_SERVER_URL    = "https://YOUR-CONVEX-SITE.convex.site";
const char* DEFAULT_SERVER_HOST   = "YOUR-CONVEX-SITE.convex.site"; // sama seperti SERVER_URL tapi TANPA "https://"

const char* SETUP_AP_SSID     = "PanicButton-Setup";
const char* SETUP_AP_PASSWORD = "setup1234";
const unsigned long CONFIG_HOLD_MS = 3000; // tahan tombol sekian lama = paksa buka portal setup

const int PIN_BUTTON  = D3;
const int PIN_BUZZER  = D5;
const int PIN_LED_R   = D6;
const int PIN_LED_G   = D7;
const int PIN_LED_Y   = D8;

// ── Sensor tambahan (opsional) — Fase 8 ──────────────────────────────────────
// Set ke TRUE hanya untuk sensor yang benar-benar kamu pasang secara fisik.
// Kalau tidak dipasang, biarkan FALSE — pin tidak akan dibaca sama sekali,
// jadi tidak ada risiko sinyal palsu dari pin yang menggantung/tidak terhubung.
const bool SENSOR_DOOR_ENABLED  = false;
const bool SENSOR_FIRE_ENABLED  = false;
const bool SENSOR_FLOOD_ENABLED = false;

const int PIN_SENSOR_DOOR  = D1;
const int PIN_SENSOR_FIRE  = D2;
const int PIN_SENSOR_FLOOD = D4;

// Sebagian modul sensor aktif LOW (nyambung ke GND saat trigger), sebagian
// aktif HIGH — tergantung merek/tipe reed switch & modul yang kamu beli.
// Default di bawah asumsi reed switch NORMALLY CLOSED (pin LOW = pintu
// tertutup/normal, pin HIGH = pintu terbuka/trigger — karena sirkuit
// terputus saat magnet menjauh). Kalau ternyata terbalik di alat kamu,
// tinggal ganti HIGH jadi LOW (atau sebaliknya) di konstanta ini.
const int SENSOR_DOOR_TRIGGERED_STATE  = HIGH;
const int SENSOR_FIRE_TRIGGERED_STATE  = LOW;  // kebanyakan modul flame sensor aktif LOW
const int SENSOR_FLOOD_TRIGGERED_STATE = LOW;  // kebanyakan modul water sensor aktif LOW

const unsigned long LONG_PRESS_MS     = 3000;
const unsigned long ESCALATION_MS     = 15000;
const unsigned long TRIPLE_TAP_WINDOW = 600;
const unsigned long HEARTBEAT_INTERVAL= 300000;
// Long-poll: request DITAHAN server sampai maksimal ~25 detik menunggu alarm,
// jauh lebih hemat dibanding polling pendek tiap 2 detik seperti sebelumnya —
// tapi TETAP nyaris instan begitu ada alarm beneran (server jawab saat itu
// juga, tidak nunggu 25 detik penuh). LONGPOLL_LOCAL_CHECK_MS = seberapa
// sering kita cek balik tombol fisik SAAT sedang menunggu jawaban server,
// supaya panic button tetap responsif walau koneksi sedang "menggantung".
const unsigned long LONGPOLL_MAX_MS        = 28000; // sedikit lebih lama dari batas server (25s) sbg jaga-jaga
const unsigned long LONGPOLL_LOCAL_CHECK_MS= 20;

// ── Konfigurasi tersimpan (EEPROM) ──────────────────────────────────────
struct DeviceConfig {
  char magic[4];        // penanda "sudah pernah disimpan" — bukan sisa memori kosong
  char ssid[64];
  char password[64];
  char serverUrl[96];
  char serverHost[64];
  char deviceId[32];
  char pairingCode[16];
};
const char CONFIG_MAGIC[4] = {'P','B','0','1'};
DeviceConfig cfg;

void loadConfig() {
  EEPROM.begin(sizeof(DeviceConfig));
  EEPROM.get(0, cfg);
  if (memcmp(cfg.magic, CONFIG_MAGIC, 4) != 0) {
    // Belum pernah disimpan — isi dari DEFAULT_* (nilai bawaan generator ini).
    memcpy(cfg.magic, CONFIG_MAGIC, 4);
    strncpy(cfg.ssid, DEFAULT_WIFI_SSID, sizeof(cfg.ssid) - 1);
    strncpy(cfg.password, DEFAULT_WIFI_PASSWORD, sizeof(cfg.password) - 1);
    strncpy(cfg.serverUrl, DEFAULT_SERVER_URL, sizeof(cfg.serverUrl) - 1);
    strncpy(cfg.serverHost, DEFAULT_SERVER_HOST, sizeof(cfg.serverHost) - 1);
    strncpy(cfg.deviceId, DEFAULT_DEVICE_ID, sizeof(cfg.deviceId) - 1);
    strncpy(cfg.pairingCode, DEFAULT_PAIRING_CODE, sizeof(cfg.pairingCode) - 1);
    EEPROM.put(0, cfg);
    EEPROM.commit();
  }
}

void saveConfig() {
  memcpy(cfg.magic, CONFIG_MAGIC, 4);
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

enum AlarmState { STATE_IDLE, STATE_COUNTDOWN, STATE_ALARM_ACTIVE, STATE_SILENT_ACTIVE, STATE_ESCALATED };
AlarmState currentState = STATE_IDLE;

bool     buttonPressed   = false;
bool     prevButtonState = HIGH;
unsigned long pressStartMs = 0;
unsigned long lastHeartbeatMs = 0;
int      tapCount = 0;
unsigned long lastTapMs = 0;
bool     escalated = false;

void setLed(bool r, bool g, bool y) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_Y, y ? HIGH : LOW);
}

// ── Portal konfigurasi (mode Access Point + halaman web sederhana) ─────
// Dipanggil kalau: belum pernah dikonfigurasi, tombol ditahan ${"~3 detik"},
// atau WiFi tersimpan gagal connect. TIDAK PERNAH return — device restart
// sendiri begitu pengaturan baru disimpan.
ESP8266WebServer configServer(80);

String configFormHtml() {
  String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>Setup Panic Button</title><style>body{font-family:sans-serif;max-width:420px;margin:24px auto;padding:0 16px}";
  html += "input{width:100%;padding:8px;margin:6px 0 14px;box-sizing:border-box}label{font-weight:bold;font-size:14px}";
  html += "button{width:100%;padding:12px;background:#e11;color:#fff;border:0;border-radius:6px;font-size:16px}</style></head><body>";
  html += "<h2>Setup Panic Button (Wemos D1)</h2><form method='POST' action='/save'>";
  html += "<label>Nama WiFi (SSID)</label><input name='ssid' value='" + String(cfg.ssid) + "'>";
  html += "<label>Password WiFi</label><input name='password' type='password' value='" + String(cfg.password) + "'>";
  html += "<label>Server URL (https://...)</label><input name='serverUrl' value='" + String(cfg.serverUrl) + "'>";
  html += "<label>Server Host (tanpa https://)</label><input name='serverHost' value='" + String(cfg.serverHost) + "'>";
  html += "<label>Device ID</label><input name='deviceId' value='" + String(cfg.deviceId) + "'>";
  html += "<label>Pairing Code</label><input name='pairingCode' value='" + String(cfg.pairingCode) + "'>";
  html += "<button type='submit'>Simpan & Restart</button></form></body></html>";
  return html;
}

void startConfigPortal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(SETUP_AP_SSID, SETUP_AP_PASSWORD);
  configServer.on("/", HTTP_GET, []() { configServer.send(200, "text/html", configFormHtml()); });
  configServer.on("/save", HTTP_POST, []() {
    strncpy(cfg.ssid, configServer.arg("ssid").c_str(), sizeof(cfg.ssid) - 1);
    strncpy(cfg.password, configServer.arg("password").c_str(), sizeof(cfg.password) - 1);
    strncpy(cfg.serverUrl, configServer.arg("serverUrl").c_str(), sizeof(cfg.serverUrl) - 1);
    strncpy(cfg.serverHost, configServer.arg("serverHost").c_str(), sizeof(cfg.serverHost) - 1);
    strncpy(cfg.deviceId, configServer.arg("deviceId").c_str(), sizeof(cfg.deviceId) - 1);
    strncpy(cfg.pairingCode, configServer.arg("pairingCode").c_str(), sizeof(cfg.pairingCode) - 1);
    saveConfig();
    configServer.send(200, "text/html", "<html><body style='font-family:sans-serif;text-align:center;margin-top:40px'><h3>Tersimpan. Device restart...</h3></body></html>");
    delay(1500);
    ESP.restart();
  });
  configServer.begin();
  unsigned long lastBlink = 0; bool on = false;
  while (true) {
    configServer.handleClient();
    if (millis() - lastBlink > 300) { lastBlink = millis(); on = !on; setLed(false, false, on); } // LED kuning kedip = mode setup
  }
}

bool httpPost(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  BearSSL::WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(cfg.serverUrl) + path)) return false;
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int code = http.POST(body);
  if (code > 0) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

bool httpGet(const char* path, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  BearSSL::WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(cfg.serverUrl) + path)) return false;
  http.setTimeout(6000);
  int code = http.GET();
  if (code == 200) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

void sendHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode; doc["wifi"] = WiFi.RSSI();
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/heartbeat", body, response);
}

// ── Sensor tambahan (pintu/api/air) — Fase 8 ────────────────────────────────
bool lastDoorState = false, lastFireState = false, lastFloodState = false;

void reportSensorEvent(const char* kind, bool triggered) {
  StaticJsonDocument<160> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  doc["sensorKind"] = kind; doc["triggered"] = triggered;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/sensor/report", body, response);
}

// Dipanggil tiap iterasi loop() — cuma digitalRead() polos, jadi sangat
// murah (mikrodetik), tidak mengganggu long-poll/tombol sama sekali. Cuma
// LAPOR ke server saat status BERUBAH (edge trigger), bukan tiap kali baca,
// supaya tidak spam request selama sensor tetap dalam kondisi trigger.
void checkSensors() {
  if (SENSOR_DOOR_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_DOOR) == SENSOR_DOOR_TRIGGERED_STATE;
    if (state != lastDoorState) { lastDoorState = state; reportSensorEvent("door", state); }
  }
  if (SENSOR_FIRE_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_FIRE) == SENSOR_FIRE_TRIGGERED_STATE;
    if (state != lastFireState) { lastFireState = state; reportSensorEvent("fire", state); }
  }
  if (SENSOR_FLOOD_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_FLOOD) == SENSOR_FLOOD_TRIGGERED_STATE;
    if (state != lastFloodState) { lastFloodState = state; reportSensorEvent("flood", state); }
  }
}

void sendAlarmOn(const char* type) {
  // ${deviceType === "community" ? "Endpoint KOMUNAL — memicu alarm atas nama LOKASI ini, bukan atas nama orang." : "Endpoint PERSONAL — memicu alarm milik pemilik device ini."}
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode; doc["type"] = type;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOnPath}", body, response);
}

void sendAlarmOff() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOffPath}", body, response);
}

void sendEscalation() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/alarm/escalate", body, response);
}

void applyAlarmStatusResult(bool serverAlarmActive, const char* remoteType) {
  if (serverAlarmActive && currentState == STATE_IDLE) {
    // Alarm dari device/anggota LAIN menargetkan device ini — bunyikan buzzer
    // walau tombol fisik device ini sendiri tidak ditekan.
    currentState = (strcmp(remoteType, "silent") == 0) ? STATE_SILENT_ACTIVE : STATE_ALARM_ACTIVE;
    setLed(currentState == STATE_ALARM_ACTIVE, false, currentState == STATE_SILENT_ACTIVE);
    if (currentState == STATE_ALARM_ACTIVE) digitalWrite(PIN_BUZZER, HIGH);
  }
  if (!serverAlarmActive && currentState != STATE_IDLE) {
    currentState = STATE_IDLE; escalated = false; setLed(false, true, false);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

// Long-poll: buka koneksi manual (bukan pakai HTTPClient yang blocking total)
// supaya SELAMA menunggu jawaban server, kita tetap bisa cek tombol fisik
// tiap ~20ms lewat handleButton(). Kalau tombol ditekan sampai jadi alarm
// LOKAL saat sedang menunggu, koneksi long-poll ini langsung dibatalkan —
// alarm dari tombol sendiri selalu prioritas #1, tidak pernah nunggu network.
void longPollAlarmStatus() {
  if (WiFi.status() != WL_CONNECTED) { delay(200); return; }

  BearSSL::WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(LONGPOLL_MAX_MS + 3000);

  if (!client.connect(cfg.serverHost, 443)) { delay(500); return; }

  String path = "/wemos/alarm/status/longpoll?deviceId="; path += cfg.deviceId; path += "&pairingCode="; path += cfg.pairingCode;
  client.print(String("GET ") + path + " HTTP/1.1\r\n" +
               "Host: " + cfg.serverHost + "\r\n" +
               "Connection: close\r\n\r\n");

  unsigned long waitStart = millis();
  while (client.connected() && !client.available()) {
    // Kunci dari desain ini: tombol fisik TETAP dicek tiap ~20ms walau
    // sedang menunggu server, jadi panic button tidak pernah "nge-lag"
    // walau request-nya ditahan sampai puluhan detik di sisi server.
    handleButton();
    checkSensors();
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED || currentState == STATE_SILENT_ACTIVE) {
      client.stop();
      return; // alarm lokal sendiri sudah dikirim di dalam handleButton() → sendAlarmOn()
    }
    if (millis() - waitStart > LONGPOLL_MAX_MS) { client.stop(); return; }
    delay(LONGPOLL_LOCAL_CHECK_MS);
  }
  if (!client.connected() && !client.available()) { client.stop(); return; } // koneksi putus sebelum ada jawaban

  // Lewati HTTP header, ambil body JSON-nya saja.
  String line;
  while (client.connected() || client.available()) {
    line = client.readStringUntil('\\n');
    if (line == "\\r" || line.length() == 0) break; // baris kosong = pemisah header/body
  }
  String body = client.readString();
  client.stop();

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, body)) return;
  bool serverAlarmActive = doc["alarmActive"] | false;
  const char* remoteType = doc["alarmType"] | "panic";
  applyAlarmStatusResult(serverAlarmActive, remoteType);
}

void handleButton() {
  bool cur = digitalRead(PIN_BUTTON);
  unsigned long now = millis();
  if (prevButtonState == HIGH && cur == LOW) {
    unsigned long gap = now - lastTapMs;
    tapCount = (gap < TRIPLE_TAP_WINDOW) ? tapCount + 1 : 1;
    lastTapMs = now;
    if (tapCount >= 3 && currentState == STATE_IDLE) {
      tapCount = 0; currentState = STATE_SILENT_ACTIVE;
      sendAlarmOn("silent"); setLed(false, false, true);
    }
    pressStartMs = now; buttonPressed = true; prevButtonState = LOW;
  }
  if (buttonPressed && cur == LOW) {
    unsigned long held = now - pressStartMs;
    if (held >= LONG_PRESS_MS && currentState == STATE_IDLE) {
      currentState = STATE_ALARM_ACTIVE; escalated = false;
      sendAlarmOn("panic"); setLed(true, false, false);
      digitalWrite(PIN_BUZZER, HIGH);
    }
    if (held >= ESCALATION_MS && !escalated && currentState == STATE_ALARM_ACTIVE) {
      escalated = true; currentState = STATE_ESCALATED; sendEscalation();
    }
  }
  if (prevButtonState == LOW && cur == HIGH) {
    buttonPressed = false; prevButtonState = HIGH;
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED) {
      currentState = STATE_IDLE; escalated = false;
      sendAlarmOff(); setLed(false, true, false); digitalWrite(PIN_BUZZER, LOW);
    }
  }
  prevButtonState = cur;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT); pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT); pinMode(PIN_LED_Y, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW); setLed(false, false, false);
  if (SENSOR_DOOR_ENABLED)  pinMode(PIN_SENSOR_DOOR, INPUT_PULLUP);
  if (SENSOR_FIRE_ENABLED)  pinMode(PIN_SENSOR_FIRE, INPUT_PULLUP);
  if (SENSOR_FLOOD_ENABLED) pinMode(PIN_SENSOR_FLOOD, INPUT_PULLUP);

  loadConfig();

  // Tombol ditahan sejak device baru nyala (bukan saat power-on fisik, itu
  // aman di board ini) = paksa buka portal setup, walau WiFi lama masih ada.
  delay(50);
  if (digitalRead(PIN_BUTTON) == LOW) {
    unsigned long t0 = millis();
    while (digitalRead(PIN_BUTTON) == LOW && millis() - t0 < CONFIG_HOLD_MS) delay(10);
    if (millis() - t0 >= CONFIG_HOLD_MS) startConfigPortal(); // tidak pernah return
  }

  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(cfg.ssid, cfg.password);
  int a = 0;
  while (WiFi.status() != WL_CONNECTED && a < 40) { delay(500); a++; setLed(false,false,true); delay(200); setLed(false,false,false); }
  if (WiFi.status() != WL_CONNECTED) startConfigPortal(); // WiFi tersimpan gagal → buka setup, tidak pernah return
  sendHeartbeat(); lastHeartbeatMs = millis();
  setLed(false, true, false);
  Serial.println("READY - Device: " + String(cfg.deviceId));
}

void loop() {
  unsigned long now = millis();
  handleButton();
  checkSensors();
  if (currentState == STATE_IDLE) setLed(false, true, false);
  // Tidak lagi berbasis interval tetap (dulu tiap 2 detik) — longPollAlarmStatus()
  // otomatis "menunggu" di dalam dirinya sendiri (nyaris instan kalau ada alarm,
  // maksimal ~28 detik kalau tidak ada), lalu loop() langsung panggil lagi.
  // Tombol fisik TETAP responsif selama menunggu (lihat komentar di dalam fungsi).
  longPollAlarmStatus();
  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL) { sendHeartbeat(); lastHeartbeatMs = now; }
  delay(10);
}
`;
}

// NodeMCU (ESP8266 Devkit) — pin GPIO sama seperti Wemos D1 Mini (satu core
// Arduino ESP8266 yang sama), tapi NodeMCU punya 2 komponen bawaan board
// yang Wemos D1 Mini tidak punya secara fisik:
//  - Tombol "FLASH" bawaan  → terhubung ke GPIO0 (D3), pin yang SAMA dengan
//    tombol PANIC eksternal di versi Wemos — jadi di NodeMCU tombol PANIC
//    bisa langsung pakai tombol FLASH ini, tidak perlu wiring tombol lagi.
//  - LED biru bawaan modul  → GPIO2 (D4, alias LED_BUILTIN), aktif-LOW —
//    dipakai di sini sebagai indikator Relay 1 ON/OFF.
// Ditambahkan juga: output RELAY 1 (D1/GPIO5) untuk menggerakkan modul
// relay eksternal (sirine tambahan/strobo/solenoid pintu/dll), yang
// otomatis ON/OFF mengikuti kondisi yang sama dengan buzzer.
function generateNodeMcuFirmware(deviceId: string, pairingCode: string, deviceType: "personal" | "community"): string {
  const alarmOnPath = deviceType === "community" ? "/wemos/community/alarm/on" : "/wemos/alarm/on";
  const alarmOffPath = deviceType === "community" ? "/wemos/community/alarm/off" : "/wemos/alarm/off";
  return `/*
 * PANIC BUTTON - Firmware NodeMCU (ESP8266)
 * Mode: ${deviceType === "community" ? "COMMUNITY (Pos Satpam/Kantor RT-RW/Fasum)" : "PERSONAL (device pribadi)"}
 *
 * BEDA DARI VERSI WEMOS D1 MINI:
 *  - Tombol PANIC memanfaatkan tombol "FLASH" BAWAAN board (GPIO0/D3) —
 *    tidak perlu pasang tombol eksternal (tapi kalau mau tombol eksternal
 *    yang lebih mudah dijangkau/lebih besar, tinggal paralel ke pin D3 & GND
 *    yang sama, tombol FLASH bawaan tetap akan berfungsi juga).
 *  - LED biru BAWAAN modul (GPIO2/D4, LED_BUILTIN) dipakai sebagai indikator
 *    Relay 1 ON/OFF — nyala saat relay ON, mati saat relay OFF.
 *  - Ditambah output RELAY 1 (D1/GPIO5) untuk perangkat eksternal (sirine
 *    tambahan, strobo, solenoid pintu, dst), ON/OFF mengikuti kondisi yang
 *    sama dengan buzzer (aktif saat panic, TIDAK aktif saat silent).
 *
 * WiFi & alamat server TIDAK perlu diedit di sini kalau tidak mau — nilai di
 * bawah cuma "isian awal" saat pertama kali setup. Cara mengisi/mengganti
 * WiFi & server TANPA reflash:
 *   1. Device pertama kali nyala (atau tekan & TAHAN tombol FLASH ±3 detik
 *      saat device sudah menyala) → device jadi hotspot WiFi bernama
 *      "PanicButton-Setup" (password: setup1234).
 *   2. Dari HP, connect ke hotspot itu, buka browser ke 192.168.4.1.
 *   3. Isi WiFi, Server URL/Host, Device ID, Pairing Code → Simpan.
 *   4. Device restart otomatis & langsung pakai pengaturan baru.
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

const char* DEFAULT_WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* DEFAULT_WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* DEFAULT_DEVICE_ID     = "${deviceId}";
const char* DEFAULT_PAIRING_CODE  = "${pairingCode}";
const char* DEFAULT_SERVER_URL    = "https://YOUR-CONVEX-SITE.convex.site";
const char* DEFAULT_SERVER_HOST   = "YOUR-CONVEX-SITE.convex.site"; // sama seperti SERVER_URL tapi TANPA "https://"

const char* SETUP_AP_SSID     = "PanicButton-Setup";
const char* SETUP_AP_PASSWORD = "setup1234";
const unsigned long CONFIG_HOLD_MS = 3000; // tahan tombol sekian lama = paksa buka portal setup

const int PIN_BUTTON      = D3;          // = GPIO0 = tombol FLASH bawaan NodeMCU
const int PIN_BUZZER      = D5;
const int PIN_LED_R       = D6;
const int PIN_LED_G       = D7;
const int PIN_LED_Y       = D8;
const int PIN_RELAY1      = D1;          // = GPIO5, ke modul relay eksternal
const int PIN_LED_ONBOARD = LED_BUILTIN; // = D4/GPIO2, LED biru bawaan modul (aktif-LOW)

// ── Sensor tambahan (opsional) — Fase 8 ──────────────────────────────────────
// NodeMCU pin-nya sudah lumayan padat (relay + LED 3 warna + LED bawaan),
// jadi CUMA muat 2 sensor tambahan (bukan 3 seperti di Wemos D1 Mini) tanpa
// mengorbankan fitur yang sudah ada. Butuh sensor api juga? Pakai board
// Wemos D1 Mini yang pin-nya masih lega untuk ketiganya sekaligus.
const bool SENSOR_DOOR_ENABLED  = false;
const bool SENSOR_FLOOD_ENABLED = false;

const int PIN_SENSOR_DOOR  = D2;  // GPIO4 — pin bebas, aman dipakai langsung
// D0 (GPIO16) SECARA HARDWARE tidak punya pull-up internal yang didukung
// penuh di ESP8266 — kalau SENSOR_FLOOD_ENABLED true, WAJIB pasang resistor
// pull-up eksternal ~10kΩ dari D0 ke 3.3V supaya pembacaan tidak "ngambang"/
// tidak stabil. Tanpa resistor eksternal, sensor ini bisa salah trigger sendiri.
const int PIN_SENSOR_FLOOD = D0;

const int SENSOR_DOOR_TRIGGERED_STATE  = HIGH;
const int SENSOR_FLOOD_TRIGGERED_STATE = LOW;

// Sebagian besar modul relay 1-channel murah (yang ada optocoupler-nya)
// AKTIF-LOW (nyala saat pin diberi LOW). Kalau modul relay Anda kebalikannya
// (aktif-HIGH), ubah baris ini jadi false.
const bool RELAY_ACTIVE_LOW = true;

const unsigned long LONG_PRESS_MS     = 3000;
const unsigned long ESCALATION_MS     = 15000;
const unsigned long TRIPLE_TAP_WINDOW = 600;
const unsigned long HEARTBEAT_INTERVAL= 300000;
const unsigned long LONGPOLL_MAX_MS        = 28000;
const unsigned long LONGPOLL_LOCAL_CHECK_MS= 20;

// ── Konfigurasi tersimpan (EEPROM) ──────────────────────────────────────
struct DeviceConfig {
  char magic[4];
  char ssid[64];
  char password[64];
  char serverUrl[96];
  char serverHost[64];
  char deviceId[32];
  char pairingCode[16];
};
const char CONFIG_MAGIC[4] = {'P','B','0','1'};
DeviceConfig cfg;

void loadConfig() {
  EEPROM.begin(sizeof(DeviceConfig));
  EEPROM.get(0, cfg);
  if (memcmp(cfg.magic, CONFIG_MAGIC, 4) != 0) {
    memcpy(cfg.magic, CONFIG_MAGIC, 4);
    strncpy(cfg.ssid, DEFAULT_WIFI_SSID, sizeof(cfg.ssid) - 1);
    strncpy(cfg.password, DEFAULT_WIFI_PASSWORD, sizeof(cfg.password) - 1);
    strncpy(cfg.serverUrl, DEFAULT_SERVER_URL, sizeof(cfg.serverUrl) - 1);
    strncpy(cfg.serverHost, DEFAULT_SERVER_HOST, sizeof(cfg.serverHost) - 1);
    strncpy(cfg.deviceId, DEFAULT_DEVICE_ID, sizeof(cfg.deviceId) - 1);
    strncpy(cfg.pairingCode, DEFAULT_PAIRING_CODE, sizeof(cfg.pairingCode) - 1);
    EEPROM.put(0, cfg);
    EEPROM.commit();
  }
}

void saveConfig() {
  memcpy(cfg.magic, CONFIG_MAGIC, 4);
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

enum AlarmState { STATE_IDLE, STATE_COUNTDOWN, STATE_ALARM_ACTIVE, STATE_SILENT_ACTIVE, STATE_ESCALATED };
AlarmState currentState = STATE_IDLE;

bool     buttonPressed   = false;
bool     prevButtonState = HIGH;
unsigned long pressStartMs = 0;
unsigned long lastHeartbeatMs = 0;
int      tapCount = 0;
unsigned long lastTapMs = 0;
bool     escalated = false;

void setLed(bool r, bool g, bool y) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_Y, y ? HIGH : LOW);
}

// Relay 1 + LED bawaan (indikator) — satu fungsi, dua output sekaligus.
void setRelay(bool on) {
  digitalWrite(PIN_RELAY1, on ? (RELAY_ACTIVE_LOW ? LOW : HIGH) : (RELAY_ACTIVE_LOW ? HIGH : LOW));
  digitalWrite(PIN_LED_ONBOARD, on ? LOW : HIGH); // LED bawaan NodeMCU aktif-LOW
}

// ── Portal konfigurasi (mode Access Point + halaman web sederhana) ─────
ESP8266WebServer configServer(80);

String configFormHtml() {
  String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>Setup Panic Button</title><style>body{font-family:sans-serif;max-width:420px;margin:24px auto;padding:0 16px}";
  html += "input{width:100%;padding:8px;margin:6px 0 14px;box-sizing:border-box}label{font-weight:bold;font-size:14px}";
  html += "button{width:100%;padding:12px;background:#e11;color:#fff;border:0;border-radius:6px;font-size:16px}</style></head><body>";
  html += "<h2>Setup Panic Button (NodeMCU)</h2><form method='POST' action='/save'>";
  html += "<label>Nama WiFi (SSID)</label><input name='ssid' value='" + String(cfg.ssid) + "'>";
  html += "<label>Password WiFi</label><input name='password' type='password' value='" + String(cfg.password) + "'>";
  html += "<label>Server URL (https://...)</label><input name='serverUrl' value='" + String(cfg.serverUrl) + "'>";
  html += "<label>Server Host (tanpa https://)</label><input name='serverHost' value='" + String(cfg.serverHost) + "'>";
  html += "<label>Device ID</label><input name='deviceId' value='" + String(cfg.deviceId) + "'>";
  html += "<label>Pairing Code</label><input name='pairingCode' value='" + String(cfg.pairingCode) + "'>";
  html += "<button type='submit'>Simpan & Restart</button></form></body></html>";
  return html;
}

void startConfigPortal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(SETUP_AP_SSID, SETUP_AP_PASSWORD);
  configServer.on("/", HTTP_GET, []() { configServer.send(200, "text/html", configFormHtml()); });
  configServer.on("/save", HTTP_POST, []() {
    strncpy(cfg.ssid, configServer.arg("ssid").c_str(), sizeof(cfg.ssid) - 1);
    strncpy(cfg.password, configServer.arg("password").c_str(), sizeof(cfg.password) - 1);
    strncpy(cfg.serverUrl, configServer.arg("serverUrl").c_str(), sizeof(cfg.serverUrl) - 1);
    strncpy(cfg.serverHost, configServer.arg("serverHost").c_str(), sizeof(cfg.serverHost) - 1);
    strncpy(cfg.deviceId, configServer.arg("deviceId").c_str(), sizeof(cfg.deviceId) - 1);
    strncpy(cfg.pairingCode, configServer.arg("pairingCode").c_str(), sizeof(cfg.pairingCode) - 1);
    saveConfig();
    configServer.send(200, "text/html", "<html><body style='font-family:sans-serif;text-align:center;margin-top:40px'><h3>Tersimpan. Device restart...</h3></body></html>");
    delay(1500);
    ESP.restart();
  });
  configServer.begin();
  unsigned long lastBlink = 0; bool on = false;
  while (true) {
    configServer.handleClient();
    if (millis() - lastBlink > 300) { lastBlink = millis(); on = !on; setLed(false, false, on); digitalWrite(PIN_LED_ONBOARD, on ? LOW : HIGH); }
  }
}

bool httpPost(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  BearSSL::WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(cfg.serverUrl) + path)) return false;
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int code = http.POST(body);
  if (code > 0) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

bool httpGet(const char* path, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  BearSSL::WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(cfg.serverUrl) + path)) return false;
  http.setTimeout(6000);
  int code = http.GET();
  if (code == 200) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

void sendHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode; doc["wifi"] = WiFi.RSSI();
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/heartbeat", body, response);
}

// ── Sensor tambahan (pintu/air) — Fase 8 ────────────────────────────────────
bool lastDoorState = false, lastFloodState = false;

void reportSensorEvent(const char* kind, bool triggered) {
  StaticJsonDocument<160> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  doc["sensorKind"] = kind; doc["triggered"] = triggered;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/sensor/report", body, response);
}

void checkSensors() {
  if (SENSOR_DOOR_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_DOOR) == SENSOR_DOOR_TRIGGERED_STATE;
    if (state != lastDoorState) { lastDoorState = state; reportSensorEvent("door", state); }
  }
  if (SENSOR_FLOOD_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_FLOOD) == SENSOR_FLOOD_TRIGGERED_STATE;
    if (state != lastFloodState) { lastFloodState = state; reportSensorEvent("flood", state); }
  }
}

void sendAlarmOn(const char* type) {
  // ${deviceType === "community" ? "Endpoint KOMUNAL — memicu alarm atas nama LOKASI ini, bukan atas nama orang." : "Endpoint PERSONAL — memicu alarm milik pemilik device ini."}
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode; doc["type"] = type;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOnPath}", body, response);
}

void sendAlarmOff() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOffPath}", body, response);
}

void sendEscalation() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/alarm/escalate", body, response);
}

void applyAlarmStatusResult(bool serverAlarmActive, const char* remoteType) {
  if (serverAlarmActive && currentState == STATE_IDLE) {
    currentState = (strcmp(remoteType, "silent") == 0) ? STATE_SILENT_ACTIVE : STATE_ALARM_ACTIVE;
    setLed(currentState == STATE_ALARM_ACTIVE, false, currentState == STATE_SILENT_ACTIVE);
    if (currentState == STATE_ALARM_ACTIVE) { digitalWrite(PIN_BUZZER, HIGH); setRelay(true); }
  }
  if (!serverAlarmActive && currentState != STATE_IDLE) {
    currentState = STATE_IDLE; escalated = false; setLed(false, true, false);
    digitalWrite(PIN_BUZZER, LOW); setRelay(false);
  }
}

void longPollAlarmStatus() {
  if (WiFi.status() != WL_CONNECTED) { delay(200); return; }

  BearSSL::WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(LONGPOLL_MAX_MS + 3000);

  if (!client.connect(cfg.serverHost, 443)) { delay(500); return; }

  String path = "/wemos/alarm/status/longpoll?deviceId="; path += cfg.deviceId; path += "&pairingCode="; path += cfg.pairingCode;
  client.print(String("GET ") + path + " HTTP/1.1\r\n" +
               "Host: " + cfg.serverHost + "\r\n" +
               "Connection: close\r\n\r\n");

  unsigned long waitStart = millis();
  while (client.connected() && !client.available()) {
    handleButton();
    checkSensors();
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED || currentState == STATE_SILENT_ACTIVE) {
      client.stop();
      return;
    }
    if (millis() - waitStart > LONGPOLL_MAX_MS) { client.stop(); return; }
    delay(LONGPOLL_LOCAL_CHECK_MS);
  }
  if (!client.connected() && !client.available()) { client.stop(); return; }

  String line;
  while (client.connected() || client.available()) {
    line = client.readStringUntil('\r');
    if (line == "\r" || line.length() == 0) break;
  }
  String body = client.readString();
  client.stop();

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, body)) return;
  bool serverAlarmActive = doc["alarmActive"] | false;
  const char* remoteType = doc["alarmType"] | "panic";
  applyAlarmStatusResult(serverAlarmActive, remoteType);
}

void handleButton() {
  bool cur = digitalRead(PIN_BUTTON);
  unsigned long now = millis();
  if (prevButtonState == HIGH && cur == LOW) {
    unsigned long gap = now - lastTapMs;
    tapCount = (gap < TRIPLE_TAP_WINDOW) ? tapCount + 1 : 1;
    lastTapMs = now;
    if (tapCount >= 3 && currentState == STATE_IDLE) {
      tapCount = 0; currentState = STATE_SILENT_ACTIVE;
      sendAlarmOn("silent"); setLed(false, false, true);
    }
    pressStartMs = now; buttonPressed = true; prevButtonState = LOW;
  }
  if (buttonPressed && cur == LOW) {
    unsigned long held = now - pressStartMs;
    if (held >= LONG_PRESS_MS && currentState == STATE_IDLE) {
      currentState = STATE_ALARM_ACTIVE; escalated = false;
      sendAlarmOn("panic"); setLed(true, false, false);
      digitalWrite(PIN_BUZZER, HIGH); setRelay(true);
    }
    if (held >= ESCALATION_MS && !escalated && currentState == STATE_ALARM_ACTIVE) {
      escalated = true; currentState = STATE_ESCALATED; sendEscalation();
    }
  }
  if (prevButtonState == LOW && cur == HIGH) {
    buttonPressed = false; prevButtonState = HIGH;
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED) {
      currentState = STATE_IDLE; escalated = false;
      sendAlarmOff(); setLed(false, true, false); digitalWrite(PIN_BUZZER, LOW); setRelay(false);
    }
  }
  prevButtonState = cur;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT); pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT); pinMode(PIN_LED_Y, OUTPUT);
  pinMode(PIN_RELAY1, OUTPUT); pinMode(PIN_LED_ONBOARD, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW); setLed(false, false, false); setRelay(false);
  if (SENSOR_DOOR_ENABLED)  pinMode(PIN_SENSOR_DOOR, INPUT_PULLUP);
  if (SENSOR_FLOOD_ENABLED) pinMode(PIN_SENSOR_FLOOD, INPUT); // D0/GPIO16: pull-up eksternal wajib kalau dipakai

  loadConfig();

  delay(50);
  if (digitalRead(PIN_BUTTON) == LOW) {
    unsigned long t0 = millis();
    while (digitalRead(PIN_BUTTON) == LOW && millis() - t0 < CONFIG_HOLD_MS) delay(10);
    if (millis() - t0 >= CONFIG_HOLD_MS) startConfigPortal(); // tidak pernah return
  }

  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(cfg.ssid, cfg.password);
  int a = 0;
  while (WiFi.status() != WL_CONNECTED && a < 40) { delay(500); a++; setLed(false,false,true); delay(200); setLed(false,false,false); }
  if (WiFi.status() != WL_CONNECTED) startConfigPortal(); // tidak pernah return
  sendHeartbeat(); lastHeartbeatMs = millis();
  setLed(false, true, false);
  Serial.println("READY - Device: " + String(cfg.deviceId));
}

void loop() {
  unsigned long now = millis();
  handleButton();
  checkSensors();
  if (currentState == STATE_IDLE) setLed(false, true, false);
  longPollAlarmStatus();
  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL) { sendHeartbeat(); lastHeartbeatMs = now; }
  delay(10);
}
`;
}

// ESP-01 (ESP8266, cuma 4 pin GPIO yang bisa dipakai: GPIO0, GPIO1(TX),
// GPIO2, GPIO3(RX)) — supaya tetap bisa jalan penuh (tombol + buzzer +
// relay + indikator) dengan pin sesempit itu, firmware ini:
//  - TIDAK memakai Serial sama sekali → GPIO1 (TX) & GPIO3 (RX) jadi bebas
//    dipakai sebagai GPIO biasa, bukan cuma buat debug lewat kabel USB-TTL.
//  - GPIO0  → tombol PANIC (INPUT_PULLUP). PENTING: jangan tahan tombol ini
//    saat menyalakan power — GPIO0 LOW saat boot = device masuk mode flash,
//    bukan mode jalan normal.
//  - GPIO2  → Relay 1 output. Kebanyakan board breakout ESP-01S sudah punya
//    LED biru bawaan yang nempel ke pin ini juga — otomatis ikut nyala/mati
//    mengikuti relay, tanpa perlu pin/komponen indikator terpisah.
//  - GPIO1 (TX) → Buzzer output.
//  - GPIO3 (RX) → satu LED status (dipakai gantian utk 3 kondisi lewat pola
//    kedip, karena pin-nya cuma sisa 1: mati=idle, kedip pelan=silent,
//    nyala terus=panic, kedip cepat=escalated/nunggu konfirmasi).
function generateEsp01Firmware(deviceId: string, pairingCode: string, deviceType: "personal" | "community"): string {
  const alarmOnPath = deviceType === "community" ? "/wemos/community/alarm/on" : "/wemos/alarm/on";
  const alarmOffPath = deviceType === "community" ? "/wemos/community/alarm/off" : "/wemos/alarm/off";
  return `/*
 * PANIC BUTTON - Firmware ESP-01 (ESP8266)
 * Mode: ${deviceType === "community" ? "COMMUNITY (Pos Satpam/Kantor RT-RW/Fasum)" : "PERSONAL (device pribadi)"}
 *
 * ESP-01 CUMA PUNYA 4 GPIO YANG BISA DIPAKAI — dialokasikan: tombol PANIC +
 * relay (output alarm — bisa disambung ke sirine/strobo eksternal) + sensor
 * pintu + sensor air/banjir. TIDAK ADA buzzer terpisah/status LED di versi
 * ini (relay-lah satu-satunya output alarm) — supaya 2 pin sisanya bisa
 * dipakai sensor. Firmware ini SENGAJA TIDAK PAKAI SERIAL SAMA SEKALI,
 * supaya pin TX (GPIO1) & RX (GPIO3) bebas dipakai sebagai GPIO biasa untuk
 * ke-2 sensor itu. Konsekuensinya: tidak ada log ke Serial Monitor.
 *
 * PENTING SOAL BOOT:
 *  - GPIO0 (tombol) HARUS HIGH saat power dinyalakan (jangan tahan tombol
 *    saat colok listrik), kalau tidak device akan masuk mode flashing.
 *  - GPIO2 (relay) juga harus dalam kondisi HIGH/mengambang saat boot —
 *    kebanyakan modul relay breakout ESP-01S sudah didesain aman untuk ini.
 *  - GPIO1/GPIO3 (sensor) tidak punya syarat boot khusus — aman dipakai
 *    sebagai input biasa begitu Serial dimatikan.
 *  - Untuk UPLOAD firmware: GPIO0 harus disambung ke GND dulu saat power-on
 *    (mode flashing), lalu lepas lagi & reset untuk kembali ke mode jalan
 *    normal. Device ini juga butuh catu daya 3.3V terpisah yang cukup arus
 *    (≥250mA) — pin 3.3V dari kebanyakan adaptor USB-TTL TIDAK CUKUP.
 *
 * WiFi & alamat server TIDAK perlu diedit di sini kalau tidak mau — nilai di
 * bawah cuma "isian awal" saat pertama kali setup. Cara mengisi/mengganti
 * WiFi & server TANPA reflash:
 *   1. Device pertama kali nyala (atau tekan & TAHAN tombol PANIC ±3 detik
 *      SAAT DEVICE SUDAH MENYALA NORMAL — bukan saat colok listrik, itu
 *      beda urusan dengan mode flashing di atas) → device jadi hotspot WiFi
 *      bernama "PanicButton-Setup" (password: setup1234).
 *   2. Dari HP, connect ke hotspot itu, buka browser ke 192.168.4.1.
 *   3. Isi WiFi, Server URL/Host, Device ID, Pairing Code → Simpan.
 *   4. Device restart otomatis & langsung pakai pengaturan baru.
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

const char* DEFAULT_WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* DEFAULT_WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* DEFAULT_DEVICE_ID     = "${deviceId}";
const char* DEFAULT_PAIRING_CODE  = "${pairingCode}";
const char* DEFAULT_SERVER_URL    = "https://YOUR-CONVEX-SITE.convex.site";
const char* DEFAULT_SERVER_HOST   = "YOUR-CONVEX-SITE.convex.site"; // sama seperti SERVER_URL tapi TANPA "https://"

const char* SETUP_AP_SSID     = "PanicButton-Setup";
const char* SETUP_AP_PASSWORD = "setup1234";
const unsigned long CONFIG_HOLD_MS = 3000; // tahan tombol sekian lama SETELAH nyala normal = paksa buka portal setup

const int PIN_BUTTON       = 0; // GPIO0 — tombol PANIC (INPUT_PULLUP)
const int PIN_RELAY1       = 2; // GPIO2 — Relay 1, SATU-SATUNYA output alarm di versi ini (kebanyakan modul ESP-01S: LED biru bawaan ikut nempel di sini)
// Serial dimatikan (lihat catatan di atas) supaya TX/RX bisa dipakai sebagai
// GPIO biasa — dipakai untuk 2 sensor tambahan, BUKAN buzzer/status LED
// terpisah lagi (4 pin ESP-01 dialokasikan: tombol + relay + 2 sensor).
const int PIN_SENSOR_DOOR  = 1; // GPIO1 / TX
const int PIN_SENSOR_FLOOD = 3; // GPIO3 / RX

// Sebagian besar modul relay 1-channel murah AKTIF-LOW (nyala saat diberi
// LOW). Kalau modul relay Anda kebalikannya (aktif-HIGH), ubah jadi false.
const bool RELAY_ACTIVE_LOW      = true;

// ── Sensor tambahan (opsional) — Fase 8 ──────────────────────────────────────
// Set ke TRUE hanya untuk sensor yang benar-benar kamu pasang secara fisik.
const bool SENSOR_DOOR_ENABLED  = false;
const bool SENSOR_FLOOD_ENABLED = false;
const int SENSOR_DOOR_TRIGGERED_STATE  = HIGH;
const int SENSOR_FLOOD_TRIGGERED_STATE = LOW;

const unsigned long LONG_PRESS_MS     = 3000;
const unsigned long ESCALATION_MS     = 15000;
const unsigned long TRIPLE_TAP_WINDOW = 600;
const unsigned long HEARTBEAT_INTERVAL= 300000;
const unsigned long LONGPOLL_MAX_MS        = 28000;
const unsigned long LONGPOLL_LOCAL_CHECK_MS= 20;

// ── Konfigurasi tersimpan (EEPROM) ──────────────────────────────────────
struct DeviceConfig {
  char magic[4];
  char ssid[64];
  char password[64];
  char serverUrl[96];
  char serverHost[64];
  char deviceId[32];
  char pairingCode[16];
};
const char CONFIG_MAGIC[4] = {'P','B','0','1'};
DeviceConfig cfg;

void loadConfig() {
  EEPROM.begin(sizeof(DeviceConfig));
  EEPROM.get(0, cfg);
  if (memcmp(cfg.magic, CONFIG_MAGIC, 4) != 0) {
    memcpy(cfg.magic, CONFIG_MAGIC, 4);
    strncpy(cfg.ssid, DEFAULT_WIFI_SSID, sizeof(cfg.ssid) - 1);
    strncpy(cfg.password, DEFAULT_WIFI_PASSWORD, sizeof(cfg.password) - 1);
    strncpy(cfg.serverUrl, DEFAULT_SERVER_URL, sizeof(cfg.serverUrl) - 1);
    strncpy(cfg.serverHost, DEFAULT_SERVER_HOST, sizeof(cfg.serverHost) - 1);
    strncpy(cfg.deviceId, DEFAULT_DEVICE_ID, sizeof(cfg.deviceId) - 1);
    strncpy(cfg.pairingCode, DEFAULT_PAIRING_CODE, sizeof(cfg.pairingCode) - 1);
    EEPROM.put(0, cfg);
    EEPROM.commit();
  }
}

void saveConfig() {
  memcpy(cfg.magic, CONFIG_MAGIC, 4);
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

enum AlarmState { STATE_IDLE, STATE_COUNTDOWN, STATE_ALARM_ACTIVE, STATE_SILENT_ACTIVE, STATE_ESCALATED };
AlarmState currentState = STATE_IDLE;

bool     buttonPressed   = false;
bool     prevButtonState = HIGH;
unsigned long pressStartMs = 0;
unsigned long lastHeartbeatMs = 0;
int      tapCount = 0;
unsigned long lastTapMs = 0;
bool     escalated = false;

// Untuk pola kedip status LED (non-blocking, jalan bareng loop() yg lain).
unsigned long lastBlinkMs = 0;
bool statusLedOn = false;

// Pin status LED sudah dialihfungsikan jadi sensor air — fungsi ini
// sengaja dibiarkan sebagai no-op (bukan dihapus) supaya semua kode lain
// yang masih memanggilnya (pola kedip WiFi/idle/alarm) tetap valid & aman,
// cuma efeknya sekarang tidak menyalakan LED fisik apapun.
void writeStatusLed(bool on) {
  (void)on; // sengaja tidak melakukan apa-apa
}

void setRelay(bool on) {
  digitalWrite(PIN_RELAY1, on ? (RELAY_ACTIVE_LOW ? LOW : HIGH) : (RELAY_ACTIVE_LOW ? HIGH : LOW));
}

// ── Portal konfigurasi (mode Access Point + halaman web sederhana) ─────
ESP8266WebServer configServer(80);

String configFormHtml() {
  String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>Setup Panic Button</title><style>body{font-family:sans-serif;max-width:420px;margin:24px auto;padding:0 16px}";
  html += "input{width:100%;padding:8px;margin:6px 0 14px;box-sizing:border-box}label{font-weight:bold;font-size:14px}";
  html += "button{width:100%;padding:12px;background:#e11;color:#fff;border:0;border-radius:6px;font-size:16px}</style></head><body>";
  html += "<h2>Setup Panic Button (ESP-01)</h2><form method='POST' action='/save'>";
  html += "<label>Nama WiFi (SSID)</label><input name='ssid' value='" + String(cfg.ssid) + "'>";
  html += "<label>Password WiFi</label><input name='password' type='password' value='" + String(cfg.password) + "'>";
  html += "<label>Server URL (https://...)</label><input name='serverUrl' value='" + String(cfg.serverUrl) + "'>";
  html += "<label>Server Host (tanpa https://)</label><input name='serverHost' value='" + String(cfg.serverHost) + "'>";
  html += "<label>Device ID</label><input name='deviceId' value='" + String(cfg.deviceId) + "'>";
  html += "<label>Pairing Code</label><input name='pairingCode' value='" + String(cfg.pairingCode) + "'>";
  html += "<button type='submit'>Simpan & Restart</button></form></body></html>";
  return html;
}

void startConfigPortal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(SETUP_AP_SSID, SETUP_AP_PASSWORD);
  configServer.on("/", HTTP_GET, []() { configServer.send(200, "text/html", configFormHtml()); });
  configServer.on("/save", HTTP_POST, []() {
    strncpy(cfg.ssid, configServer.arg("ssid").c_str(), sizeof(cfg.ssid) - 1);
    strncpy(cfg.password, configServer.arg("password").c_str(), sizeof(cfg.password) - 1);
    strncpy(cfg.serverUrl, configServer.arg("serverUrl").c_str(), sizeof(cfg.serverUrl) - 1);
    strncpy(cfg.serverHost, configServer.arg("serverHost").c_str(), sizeof(cfg.serverHost) - 1);
    strncpy(cfg.deviceId, configServer.arg("deviceId").c_str(), sizeof(cfg.deviceId) - 1);
    strncpy(cfg.pairingCode, configServer.arg("pairingCode").c_str(), sizeof(cfg.pairingCode) - 1);
    saveConfig();
    configServer.send(200, "text/html", "<html><body style='font-family:sans-serif;text-align:center;margin-top:40px'><h3>Tersimpan. Device restart...</h3></body></html>");
    delay(1500);
    ESP.restart();
  });
  configServer.begin();
  unsigned long lastBlink = 0; bool on = false;
  while (true) {
    configServer.handleClient();
    if (millis() - lastBlink > 300) { lastBlink = millis(); on = !on; writeStatusLed(on); }
  }
}

bool httpPost(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  BearSSL::WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(cfg.serverUrl) + path)) return false;
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int code = http.POST(body);
  if (code > 0) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

bool httpGet(const char* path, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  BearSSL::WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(cfg.serverUrl) + path)) return false;
  http.setTimeout(6000);
  int code = http.GET();
  if (code == 200) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

// Dipanggil tiap loop() — gantikan setLed() 3-warna versi Wemos/NodeMCU,
// karena ESP-01 cuma sisa 1 pin buat indikator. Pola kedipnya yang
// membedakan kondisi, bukan warna.
void updateStatusLed() {
  unsigned long now = millis();
  switch (currentState) {
    case STATE_IDLE:
      writeStatusLed(false);
      break;
    case STATE_SILENT_ACTIVE:
      if (now - lastBlinkMs >= 600) { statusLedOn = !statusLedOn; lastBlinkMs = now; writeStatusLed(statusLedOn); }
      break;
    case STATE_ALARM_ACTIVE:
      writeStatusLed(true);
      break;
    case STATE_ESCALATED:
      if (now - lastBlinkMs >= 150) { statusLedOn = !statusLedOn; lastBlinkMs = now; writeStatusLed(statusLedOn); }
      break;
    default:
      break;
  }
}

void sendHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode; doc["wifi"] = WiFi.RSSI();
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/heartbeat", body, response);
}

// ── Sensor tambahan (pintu/air) — Fase 8 ────────────────────────────────────
bool lastDoorState = false, lastFloodState = false;

void reportSensorEvent(const char* kind, bool triggered) {
  StaticJsonDocument<160> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  doc["sensorKind"] = kind; doc["triggered"] = triggered;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/sensor/report", body, response);
}

void checkSensors() {
  if (SENSOR_DOOR_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_DOOR) == SENSOR_DOOR_TRIGGERED_STATE;
    if (state != lastDoorState) { lastDoorState = state; reportSensorEvent("door", state); }
  }
  if (SENSOR_FLOOD_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_FLOOD) == SENSOR_FLOOD_TRIGGERED_STATE;
    if (state != lastFloodState) { lastFloodState = state; reportSensorEvent("flood", state); }
  }
}

void sendAlarmOn(const char* type) {
  // ${deviceType === "community" ? "Endpoint KOMUNAL — memicu alarm atas nama LOKASI ini, bukan atas nama orang." : "Endpoint PERSONAL — memicu alarm milik pemilik device ini."}
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode; doc["type"] = type;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOnPath}", body, response);
}

void sendAlarmOff() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOffPath}", body, response);
}

void sendEscalation() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfg.deviceId; doc["pairingCode"] = cfg.pairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/alarm/escalate", body, response);
}

void applyAlarmStatusResult(bool serverAlarmActive, const char* remoteType) {
  if (serverAlarmActive && currentState == STATE_IDLE) {
    currentState = (strcmp(remoteType, "silent") == 0) ? STATE_SILENT_ACTIVE : STATE_ALARM_ACTIVE;
    if (currentState == STATE_ALARM_ACTIVE) { setRelay(true); }
  }
  if (!serverAlarmActive && currentState != STATE_IDLE) {
    currentState = STATE_IDLE; escalated = false;
    setRelay(false);
  }
}

void longPollAlarmStatus() {
  if (WiFi.status() != WL_CONNECTED) { delay(200); return; }

  BearSSL::WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(LONGPOLL_MAX_MS + 3000);

  if (!client.connect(cfg.serverHost, 443)) { delay(500); return; }

  String path = "/wemos/alarm/status/longpoll?deviceId="; path += cfg.deviceId; path += "&pairingCode="; path += cfg.pairingCode;
  client.print(String("GET ") + path + " HTTP/1.1\r\n" +
               "Host: " + cfg.serverHost + "\r\n" +
               "Connection: close\r\n\r\n");

  unsigned long waitStart = millis();
  while (client.connected() && !client.available()) {
    handleButton();
    checkSensors();
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED || currentState == STATE_SILENT_ACTIVE) {
      client.stop();
      return;
    }
    if (millis() - waitStart > LONGPOLL_MAX_MS) { client.stop(); return; }
    delay(LONGPOLL_LOCAL_CHECK_MS);
  }
  if (!client.connected() && !client.available()) { client.stop(); return; }

  String line;
  while (client.connected() || client.available()) {
    line = client.readStringUntil('\r');
    if (line == "\r" || line.length() == 0) break;
  }
  String body = client.readString();
  client.stop();

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, body)) return;
  bool serverAlarmActive = doc["alarmActive"] | false;
  const char* remoteType = doc["alarmType"] | "panic";
  applyAlarmStatusResult(serverAlarmActive, remoteType);
}

void handleButton() {
  bool cur = digitalRead(PIN_BUTTON);
  unsigned long now = millis();
  if (prevButtonState == HIGH && cur == LOW) {
    unsigned long gap = now - lastTapMs;
    tapCount = (gap < TRIPLE_TAP_WINDOW) ? tapCount + 1 : 1;
    lastTapMs = now;
    if (tapCount >= 3 && currentState == STATE_IDLE) {
      tapCount = 0; currentState = STATE_SILENT_ACTIVE;
      sendAlarmOn("silent");
    }
    pressStartMs = now; buttonPressed = true; prevButtonState = LOW;
  }
  if (buttonPressed && cur == LOW) {
    unsigned long held = now - pressStartMs;
    if (held >= LONG_PRESS_MS && currentState == STATE_IDLE) {
      currentState = STATE_ALARM_ACTIVE; escalated = false;
      sendAlarmOn("panic");
      setRelay(true);
    }
    if (held >= ESCALATION_MS && !escalated && currentState == STATE_ALARM_ACTIVE) {
      escalated = true; currentState = STATE_ESCALATED; sendEscalation();
    }
  }
  if (prevButtonState == LOW && cur == HIGH) {
    buttonPressed = false; prevButtonState = HIGH;
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED) {
      currentState = STATE_IDLE; escalated = false;
      sendAlarmOff(); setRelay(false);
    }
  }
  prevButtonState = cur;
}

void setup() {
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_RELAY1, OUTPUT);
  if (SENSOR_DOOR_ENABLED)  pinMode(PIN_SENSOR_DOOR, INPUT_PULLUP);
  if (SENSOR_FLOOD_ENABLED) pinMode(PIN_SENSOR_FLOOD, INPUT_PULLUP);
  setRelay(false); writeStatusLed(false);

  loadConfig();

  // Aman dicek di sini (bukan di momen power-on fisik) — bootstrap GPIO0
  // untuk pemilihan mode boot sudah selesai begitu setup() jalan.
  delay(50);
  if (digitalRead(PIN_BUTTON) == LOW) {
    unsigned long t0 = millis();
    while (digitalRead(PIN_BUTTON) == LOW && millis() - t0 < CONFIG_HOLD_MS) delay(10);
    if (millis() - t0 >= CONFIG_HOLD_MS) startConfigPortal(); // tidak pernah return
  }

  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(cfg.ssid, cfg.password);
  int a = 0;
  while (WiFi.status() != WL_CONNECTED && a < 40) { delay(500); a++; writeStatusLed(true); delay(200); writeStatusLed(false); }
  if (WiFi.status() != WL_CONNECTED) startConfigPortal(); // tidak pernah return
  sendHeartbeat(); lastHeartbeatMs = millis();
}

void loop() {
  unsigned long now = millis();
  handleButton();
  checkSensors();
  updateStatusLed();
  longPollAlarmStatus();
  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL) { sendHeartbeat(); lastHeartbeatMs = now; }
  delay(10);
}
`;
}

// ESP32-C3 (mis. ESP32-C3-DevKitM-1, "SuperMini" C3, dsb) — sama seperti
// pendekatan NodeMCU: manfaatkan tombol & LED BAWAAN BOARD, jadi tidak perlu
// pasang tombol/LED indikator eksternal lagi untuk fungsi utamanya.
//  - Tombol "BOOT" bawaan   → GPIO9 — dipakai sebagai tombol PANIC.
//  - LED bawaan modul       → GPIO8, aktif-LOW pada kebanyakan board — dipakai
//    sebagai indikator Relay 1 ON/OFF, sama seperti versi NodeMCU.
// CATATAN: GPIO8 & GPIO9 di ESP32-C3 itu strapping pin (dipakai chip untuk
// menentukan mode boot). Ini AMAN dipakai karena pabrikan board sendiri yang
// sudah mendesain tombol BOOT & LED bawaan menempel di situ — tapi berlaku
// aturan sama seperti tombol FLASH NodeMCU / GPIO0 ESP-01: JANGAN menahan
// tombol BOOT saat menyalakan power, supaya device boot normal bukan masuk
// mode download.
// Beda chip (ESP32, bukan ESP8266) → library WiFi/HTTP-nya beda dari 3 board
// sebelumnya (pakai <WiFi.h> & <WiFiClientSecure.h> bawaan Arduino-ESP32,
// bukan ESP8266WiFi/BearSSL), tapi alur logika panic button-nya identik.
function generateEsp32C3Firmware(deviceId: string, pairingCode: string, deviceType: "personal" | "community"): string {
  const alarmOnPath = deviceType === "community" ? "/wemos/community/alarm/on" : "/wemos/alarm/on";
  const alarmOffPath = deviceType === "community" ? "/wemos/community/alarm/off" : "/wemos/alarm/off";
  return `/*
 * PANIC BUTTON - Firmware ESP32-C3
 * Mode: ${deviceType === "community" ? "COMMUNITY (Pos Satpam/Kantor RT-RW/Fasum)" : "PERSONAL (device pribadi)"}
 *
 * MEMANFAATKAN TOMBOL & LED BAWAAN BOARD (sama seperti versi NodeMCU):
 *  - Tombol PANIC = tombol "BOOT" bawaan board (GPIO9) — tidak perlu pasang
 *    tombol eksternal (boleh tetap ditambah paralel ke GPIO9 & GND kalau mau
 *    tombol fisik yang lebih besar/mudah dijangkau).
 *  - LED bawaan board (GPIO8, aktif-LOW di kebanyakan board) dipakai sebagai
 *    indikator Relay 1 ON/OFF — nyala saat relay ON.
 *  - Ditambah output RELAY 1 (GPIO4) untuk perangkat eksternal (sirine
 *    tambahan, strobo, solenoid pintu, dst), ON/OFF mengikuti kondisi yang
 *    sama dengan buzzer (aktif saat panic, TIDAK aktif saat silent).
 *
 * CATATAN BOARD: sebagian ESP32-C3 (mis. ESP32-C3-DevKitM-1 resmi Espressif)
 * punya LED bawaan tipe RGB addressable (WS2812) di GPIO8, BUKAN LED biasa —
 * kalau board Anda begitu, ganti bagian setRelay() di bawah untuk pakai
 * library FastLED/Adafruit_NeoPixel alih-alih digitalWrite() biasa. Board
 * "SuperMini"/generic C3 kebanyakan pakai LED biasa aktif-LOW seperti di
 * kode ini — cek dulu tipe LED di board Anda kalau indikatornya tidak nyala.
 *
 * WiFi & alamat server TIDAK perlu diedit di sini kalau tidak mau — nilai di
 * bawah cuma "isian awal" saat pertama kali setup. Cara mengisi/mengganti
 * WiFi & server TANPA reflash:
 *   1. Device pertama kali nyala (atau tekan & TAHAN tombol BOOT ±3 detik
 *      saat device sudah menyala) → device jadi hotspot WiFi bernama
 *      "PanicButton-Setup" (password: setup1234).
 *   2. Dari HP, connect ke hotspot itu, buka browser ke 192.168.4.1.
 *   3. Isi WiFi, Server URL/Host, Device ID, Pairing Code → Simpan.
 *   4. Device restart otomatis & langsung pakai pengaturan baru.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>

const char* DEFAULT_WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* DEFAULT_WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* DEFAULT_DEVICE_ID     = "${deviceId}";
const char* DEFAULT_PAIRING_CODE  = "${pairingCode}";
const char* DEFAULT_SERVER_URL    = "https://YOUR-CONVEX-SITE.convex.site";
const char* DEFAULT_SERVER_HOST   = "YOUR-CONVEX-SITE.convex.site"; // sama seperti SERVER_URL tapi TANPA "https://"

const char* SETUP_AP_SSID     = "PanicButton-Setup";
const char* SETUP_AP_PASSWORD = "setup1234";
const unsigned long CONFIG_HOLD_MS = 3000; // tahan tombol sekian lama = paksa buka portal setup

const int PIN_BUTTON      = 9;  // GPIO9 — tombol BOOT bawaan board
const int PIN_LED_ONBOARD = 8;  // GPIO8 — LED bawaan board (aktif-LOW di kebanyakan board)
const int PIN_RELAY1      = 4;  // GPIO4, ke modul relay eksternal
const int PIN_BUZZER      = 5;  // GPIO5
const int PIN_LED_R       = 6;  // GPIO6
const int PIN_LED_G       = 7;  // GPIO7
const int PIN_LED_Y       = 10; // GPIO10

// ── Sensor tambahan (opsional) — Fase 8 ──────────────────────────────────────
// ESP32-C3 masih punya banyak pin bebas, jadi muat 3 sensor penuh seperti
// versi Wemos D1 Mini. GPIO2 sengaja DIHINDARI (di beberapa varian board
// dipakai sebagai strapping pin boot) — kalau board Anda beda pinout,
// sesuaikan nomor GPIO di bawah dengan datasheet board Anda.
const bool SENSOR_DOOR_ENABLED  = false;
const bool SENSOR_FIRE_ENABLED  = false;
const bool SENSOR_FLOOD_ENABLED = false;

const int PIN_SENSOR_DOOR  = 0;  // GPIO0
const int PIN_SENSOR_FIRE  = 1;  // GPIO1
const int PIN_SENSOR_FLOOD = 3;  // GPIO3

const int SENSOR_DOOR_TRIGGERED_STATE  = HIGH;
const int SENSOR_FIRE_TRIGGERED_STATE  = LOW;
const int SENSOR_FLOOD_TRIGGERED_STATE = LOW;

// Sebagian besar modul relay 1-channel murah (yang ada optocoupler-nya)
// AKTIF-LOW (nyala saat pin diberi LOW). Kalau modul relay Anda kebalikannya
// (aktif-HIGH), ubah baris ini jadi false.
const bool RELAY_ACTIVE_LOW = true;

const unsigned long LONG_PRESS_MS     = 3000;
const unsigned long ESCALATION_MS     = 15000;
const unsigned long TRIPLE_TAP_WINDOW = 600;
const unsigned long HEARTBEAT_INTERVAL= 300000;
const unsigned long LONGPOLL_MAX_MS        = 28000;
const unsigned long LONGPOLL_LOCAL_CHECK_MS= 20;

// ── Konfigurasi tersimpan (NVS lewat library Preferences bawaan ESP32) ──
Preferences prefs;
String cfgSsid, cfgPassword, cfgServerUrl, cfgServerHost, cfgDeviceId, cfgPairingCode;

void loadConfig() {
  prefs.begin("pbcfg", false);
  cfgSsid        = prefs.getString("ssid", DEFAULT_WIFI_SSID);
  cfgPassword    = prefs.getString("password", DEFAULT_WIFI_PASSWORD);
  cfgServerUrl   = prefs.getString("serverUrl", DEFAULT_SERVER_URL);
  cfgServerHost  = prefs.getString("serverHost", DEFAULT_SERVER_HOST);
  cfgDeviceId    = prefs.getString("deviceId", DEFAULT_DEVICE_ID);
  cfgPairingCode = prefs.getString("pairingCode", DEFAULT_PAIRING_CODE);
}

void saveConfig() {
  prefs.putString("ssid", cfgSsid);
  prefs.putString("password", cfgPassword);
  prefs.putString("serverUrl", cfgServerUrl);
  prefs.putString("serverHost", cfgServerHost);
  prefs.putString("deviceId", cfgDeviceId);
  prefs.putString("pairingCode", cfgPairingCode);
}

enum AlarmState { STATE_IDLE, STATE_COUNTDOWN, STATE_ALARM_ACTIVE, STATE_SILENT_ACTIVE, STATE_ESCALATED };
AlarmState currentState = STATE_IDLE;

bool     buttonPressed   = false;
bool     prevButtonState = HIGH;
unsigned long pressStartMs = 0;
unsigned long lastHeartbeatMs = 0;
int      tapCount = 0;
unsigned long lastTapMs = 0;
bool     escalated = false;

void setLed(bool r, bool g, bool y) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_Y, y ? HIGH : LOW);
}

// Relay 1 + LED bawaan (indikator) — satu fungsi, dua output sekaligus.
void setRelay(bool on) {
  digitalWrite(PIN_RELAY1, on ? (RELAY_ACTIVE_LOW ? LOW : HIGH) : (RELAY_ACTIVE_LOW ? HIGH : LOW));
  digitalWrite(PIN_LED_ONBOARD, on ? LOW : HIGH); // LED bawaan board aktif-LOW
}

// ── Portal konfigurasi (mode Access Point + halaman web sederhana) ─────
WebServer configServer(80);

String configFormHtml() {
  String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>Setup Panic Button</title><style>body{font-family:sans-serif;max-width:420px;margin:24px auto;padding:0 16px}";
  html += "input{width:100%;padding:8px;margin:6px 0 14px;box-sizing:border-box}label{font-weight:bold;font-size:14px}";
  html += "button{width:100%;padding:12px;background:#e11;color:#fff;border:0;border-radius:6px;font-size:16px}</style></head><body>";
  html += "<h2>Setup Panic Button (ESP32-C3)</h2><form method='POST' action='/save'>";
  html += "<label>Nama WiFi (SSID)</label><input name='ssid' value='" + cfgSsid + "'>";
  html += "<label>Password WiFi</label><input name='password' type='password' value='" + cfgPassword + "'>";
  html += "<label>Server URL (https://...)</label><input name='serverUrl' value='" + cfgServerUrl + "'>";
  html += "<label>Server Host (tanpa https://)</label><input name='serverHost' value='" + cfgServerHost + "'>";
  html += "<label>Device ID</label><input name='deviceId' value='" + cfgDeviceId + "'>";
  html += "<label>Pairing Code</label><input name='pairingCode' value='" + cfgPairingCode + "'>";
  html += "<button type='submit'>Simpan & Restart</button></form></body></html>";
  return html;
}

void startConfigPortal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(SETUP_AP_SSID, SETUP_AP_PASSWORD);
  configServer.on("/", HTTP_GET, []() { configServer.send(200, "text/html", configFormHtml()); });
  configServer.on("/save", HTTP_POST, []() {
    cfgSsid = configServer.arg("ssid");
    cfgPassword = configServer.arg("password");
    cfgServerUrl = configServer.arg("serverUrl");
    cfgServerHost = configServer.arg("serverHost");
    cfgDeviceId = configServer.arg("deviceId");
    cfgPairingCode = configServer.arg("pairingCode");
    saveConfig();
    configServer.send(200, "text/html", "<html><body style='font-family:sans-serif;text-align:center;margin-top:40px'><h3>Tersimpan. Device restart...</h3></body></html>");
    delay(1500);
    ESP.restart();
  });
  configServer.begin();
  unsigned long lastBlink = 0; bool on = false;
  while (true) {
    configServer.handleClient();
    if (millis() - lastBlink > 300) { lastBlink = millis(); on = !on; setLed(false, false, on); digitalWrite(PIN_LED_ONBOARD, on ? LOW : HIGH); }
  }
}

bool httpPost(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, cfgServerUrl + path)) return false;
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int code = http.POST(body);
  if (code > 0) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

bool httpGet(const char* path, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, cfgServerUrl + path)) return false;
  http.setTimeout(6000);
  int code = http.GET();
  if (code == 200) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

void sendHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfgDeviceId; doc["pairingCode"] = cfgPairingCode; doc["wifi"] = WiFi.RSSI();
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/heartbeat", body, response);
}

// ── Sensor tambahan (pintu/api/air) — Fase 8 ────────────────────────────────
bool lastDoorState = false, lastFireState = false, lastFloodState = false;

void reportSensorEvent(const char* kind, bool triggered) {
  StaticJsonDocument<160> doc;
  doc["deviceId"] = cfgDeviceId; doc["pairingCode"] = cfgPairingCode;
  doc["sensorKind"] = kind; doc["triggered"] = triggered;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/sensor/report", body, response);
}

void checkSensors() {
  if (SENSOR_DOOR_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_DOOR) == SENSOR_DOOR_TRIGGERED_STATE;
    if (state != lastDoorState) { lastDoorState = state; reportSensorEvent("door", state); }
  }
  if (SENSOR_FIRE_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_FIRE) == SENSOR_FIRE_TRIGGERED_STATE;
    if (state != lastFireState) { lastFireState = state; reportSensorEvent("fire", state); }
  }
  if (SENSOR_FLOOD_ENABLED) {
    bool state = digitalRead(PIN_SENSOR_FLOOD) == SENSOR_FLOOD_TRIGGERED_STATE;
    if (state != lastFloodState) { lastFloodState = state; reportSensorEvent("flood", state); }
  }
}

void sendAlarmOn(const char* type) {
  // ${deviceType === "community" ? "Endpoint KOMUNAL — memicu alarm atas nama LOKASI ini, bukan atas nama orang." : "Endpoint PERSONAL — memicu alarm milik pemilik device ini."}
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfgDeviceId; doc["pairingCode"] = cfgPairingCode; doc["type"] = type;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOnPath}", body, response);
}

void sendAlarmOff() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfgDeviceId; doc["pairingCode"] = cfgPairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOffPath}", body, response);
}

void sendEscalation() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = cfgDeviceId; doc["pairingCode"] = cfgPairingCode;
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/alarm/escalate", body, response);
}

void applyAlarmStatusResult(bool serverAlarmActive, const char* remoteType) {
  if (serverAlarmActive && currentState == STATE_IDLE) {
    currentState = (strcmp(remoteType, "silent") == 0) ? STATE_SILENT_ACTIVE : STATE_ALARM_ACTIVE;
    setLed(currentState == STATE_ALARM_ACTIVE, false, currentState == STATE_SILENT_ACTIVE);
    if (currentState == STATE_ALARM_ACTIVE) { digitalWrite(PIN_BUZZER, HIGH); setRelay(true); }
  }
  if (!serverAlarmActive && currentState != STATE_IDLE) {
    currentState = STATE_IDLE; escalated = false; setLed(false, true, false);
    digitalWrite(PIN_BUZZER, LOW); setRelay(false);
  }
}

void longPollAlarmStatus() {
  if (WiFi.status() != WL_CONNECTED) { delay(200); return; }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(LONGPOLL_MAX_MS + 3000);

  if (!client.connect(cfgServerHost.c_str(), 443)) { delay(500); return; }

  String path = "/wemos/alarm/status/longpoll?deviceId="; path += cfgDeviceId; path += "&pairingCode="; path += cfgPairingCode;
  client.print(String("GET ") + path + " HTTP/1.1\r\n" +
               "Host: " + cfgServerHost + "\r\n" +
               "Connection: close\r\n\r\n");

  unsigned long waitStart = millis();
  while (client.connected() && !client.available()) {
    handleButton();
    checkSensors();
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED || currentState == STATE_SILENT_ACTIVE) {
      client.stop();
      return;
    }
    if (millis() - waitStart > LONGPOLL_MAX_MS) { client.stop(); return; }
    delay(LONGPOLL_LOCAL_CHECK_MS);
  }
  if (!client.connected() && !client.available()) { client.stop(); return; }

  String line;
  while (client.connected() || client.available()) {
    line = client.readStringUntil('\r');
    if (line == "\r" || line.length() == 0) break;
  }
  String body = client.readString();
  client.stop();

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, body)) return;
  bool serverAlarmActive = doc["alarmActive"] | false;
  const char* remoteType = doc["alarmType"] | "panic";
  applyAlarmStatusResult(serverAlarmActive, remoteType);
}

void handleButton() {
  bool cur = digitalRead(PIN_BUTTON);
  unsigned long now = millis();
  if (prevButtonState == HIGH && cur == LOW) {
    unsigned long gap = now - lastTapMs;
    tapCount = (gap < TRIPLE_TAP_WINDOW) ? tapCount + 1 : 1;
    lastTapMs = now;
    if (tapCount >= 3 && currentState == STATE_IDLE) {
      tapCount = 0; currentState = STATE_SILENT_ACTIVE;
      sendAlarmOn("silent"); setLed(false, false, true);
    }
    pressStartMs = now; buttonPressed = true; prevButtonState = LOW;
  }
  if (buttonPressed && cur == LOW) {
    unsigned long held = now - pressStartMs;
    if (held >= LONG_PRESS_MS && currentState == STATE_IDLE) {
      currentState = STATE_ALARM_ACTIVE; escalated = false;
      sendAlarmOn("panic"); setLed(true, false, false);
      digitalWrite(PIN_BUZZER, HIGH); setRelay(true);
    }
    if (held >= ESCALATION_MS && !escalated && currentState == STATE_ALARM_ACTIVE) {
      escalated = true; currentState = STATE_ESCALATED; sendEscalation();
    }
  }
  if (prevButtonState == LOW && cur == HIGH) {
    buttonPressed = false; prevButtonState = HIGH;
    if (currentState == STATE_ALARM_ACTIVE || currentState == STATE_ESCALATED) {
      currentState = STATE_IDLE; escalated = false;
      sendAlarmOff(); setLed(false, true, false); digitalWrite(PIN_BUZZER, LOW); setRelay(false);
    }
  }
  prevButtonState = cur;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT); pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT); pinMode(PIN_LED_Y, OUTPUT);
  pinMode(PIN_RELAY1, OUTPUT); pinMode(PIN_LED_ONBOARD, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW); setLed(false, false, false); setRelay(false);
  if (SENSOR_DOOR_ENABLED)  pinMode(PIN_SENSOR_DOOR, INPUT_PULLUP);
  if (SENSOR_FIRE_ENABLED)  pinMode(PIN_SENSOR_FIRE, INPUT_PULLUP);
  if (SENSOR_FLOOD_ENABLED) pinMode(PIN_SENSOR_FLOOD, INPUT_PULLUP);

  loadConfig();

  delay(50);
  if (digitalRead(PIN_BUTTON) == LOW) {
    unsigned long t0 = millis();
    while (digitalRead(PIN_BUTTON) == LOW && millis() - t0 < CONFIG_HOLD_MS) delay(10);
    if (millis() - t0 >= CONFIG_HOLD_MS) startConfigPortal(); // tidak pernah return
  }

  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(cfgSsid.c_str(), cfgPassword.c_str());
  int a = 0;
  while (WiFi.status() != WL_CONNECTED && a < 40) { delay(500); a++; setLed(false,false,true); delay(200); setLed(false,false,false); }
  if (WiFi.status() != WL_CONNECTED) startConfigPortal(); // tidak pernah return
  sendHeartbeat(); lastHeartbeatMs = millis();
  setLed(false, true, false);
  Serial.println("READY - Device: " + cfgDeviceId);
}

void loop() {
  unsigned long now = millis();
  handleButton();
  checkSensors();
  if (currentState == STATE_IDLE) setLed(false, true, false);
  longPollAlarmStatus();
  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL) { sendHeartbeat(); lastHeartbeatMs = now; }
  delay(10);
}
`;
}

function CodeBlock({ code, language = "cpp" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Kode disalin ke clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative rounded-xl overflow-hidden border border-border">
      <div className="flex items-center justify-between bg-card/80 px-4 py-2 border-b border-border">
        <span className="text-xs font-mono text-muted-foreground">{language}</span>
        <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-accent">
          {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
          {copied ? "Disalin!" : "Salin"}
        </button>
      </div>
      <pre className="bg-background text-xs text-foreground overflow-x-auto p-4 leading-relaxed max-h-[500px] font-mono"><code>{code}</code></pre>
    </div>
  );
}

const BOARD_META: Record<BoardType, {
  label: string;
  shortLabel: string;
  boardManagerName: string;
  uploadSpeed: string;
  extraNotes?: string;
  wiring: string;
  components: string[];
}> = {
  wemosd1: {
    label: "Wemos D1 Mini",
    shortLabel: "Wemos D1",
    boardManagerName: "LOLIN(WEMOS) D1 R2 & mini",
    uploadSpeed: "921600",
    extraNotes: "WiFi & alamat server TIDAK hardcode lagi — tekan & tahan tombol PANIC ±3 detik (device sudah nyala normal) untuk buka portal setup: device jadi hotspot \"PanicButton-Setup\" (password: setup1234), buka 192.168.4.1 dari HP untuk isi WiFi/Server/Device ID/Pairing Code tanpa reflash.",
    wiring: `Wemos D1 Mini  →  Komponen
─────────────────────────────────────
D3 (GPIO 0)   →  Tombol PANIC kaki 1
GND           →  Tombol PANIC kaki 2 (PULLUP active LOW)
D5 (GPIO 14)  →  Buzzer+ piezo
GND           →  Buzzer-
D6 (GPIO 12)  →  LED Merah (220Ω)
D7 (GPIO 13)  →  LED Hijau (220Ω)
D8 (GPIO 15)  →  LED Kuning (220Ω)
GND           →  Katoda semua LED`,
    components: ["1× Wemos D1 Mini (ESP8266)", "1× Tombol tekan (push button)", "1× Buzzer piezo 5V", "1× LED merah, 1× LED hijau, 1× LED kuning", "3× Resistor 220Ω", "Breadboard + kabel jumper"],
  },
  nodemcu: {
    label: "NodeMCU (ESP8266 Devkit)",
    shortLabel: "NodeMCU",
    boardManagerName: "NodeMCU 1.0 (ESP-12E Module)",
    uploadSpeed: "115200",
    extraNotes: "Kalau upload di 115200 lancar, boleh dicoba naikkan ke 921600 supaya lebih cepat — tapi kalau sering gagal/timeout, turunkan lagi ke 115200 atau 57600. WiFi & alamat server TIDAK hardcode lagi — tekan & tahan tombol FLASH bawaan ±3 detik (device sudah nyala normal) untuk buka portal setup: device jadi hotspot \"PanicButton-Setup\" (password: setup1234), buka 192.168.4.1 dari HP untuk isi WiFi/Server/Device ID/Pairing Code tanpa reflash.",
    wiring: `NodeMCU  →  Komponen
─────────────────────────────────────
(bawaan)      →  Tombol FLASH board = Tombol PANIC (GPIO0/D3, TIDAK PERLU wiring tambahan)
(bawaan)      →  LED biru board = Indikator Relay 1 (GPIO2/D4, otomatis)
D1 (GPIO 5)   →  Modul Relay 1 (pin IN)
5V / GND      →  Modul Relay 1 (VCC / GND — sesuai spek modul relay Anda)
D5 (GPIO 14)  →  Buzzer+ piezo
GND           →  Buzzer-
D6 (GPIO 12)  →  LED Merah (220Ω)
D7 (GPIO 13)  →  LED Hijau (220Ω)
D8 (GPIO 15)  →  LED Kuning (220Ω)
GND           →  Katoda semua LED`,
    components: ["1× NodeMCU (ESP8266 Devkit)", "1× Modul Relay 1 channel (5V, aktif-LOW umumnya)", "1× Buzzer piezo 5V", "1× LED merah, 1× LED hijau, 1× LED kuning", "3× Resistor 220Ω", "Breadboard + kabel jumper", "(Tombol PANIC & LED indikator relay pakai yang sudah bawaan board — tidak perlu beli)"],
  },
  esp01: {
    label: "ESP-01 (ESP8266)",
    shortLabel: "ESP-01",
    boardManagerName: "Generic ESP8266 Module",
    uploadSpeed: "115200",
    extraNotes: "Flash Size: \"1M (FS:none)\" (cek label chip flash di board Anda — sebagian ESP-01 lawas cuma 512K). Untuk MASUK MODE UPLOAD: sambungkan GPIO0 ke GND dulu, baru nyalakan/reset power, upload, lalu lepas sambungan GPIO0-GND dan reset lagi untuk kembali ke mode jalan normal. Device ini butuh catu daya 3.3V terpisah yang cukup arus (≥250mA) — pin 3.3V bawaan kebanyakan adaptor USB-TTL tidak cukup kuat. WiFi & alamat server TIDAK hardcode lagi — tekan & tahan tombol PANIC ±3 detik SETELAH device menyala normal (bukan saat colok listrik, itu urusan mode upload di atas) untuk buka portal setup: hotspot \"PanicButton-Setup\" (password: setup1234), buka 192.168.4.1 dari HP.",
    wiring: `ESP-01  →  Komponen
─────────────────────────────────────
GPIO0         →  Tombol PANIC kaki 1 (INPUT_PULLUP internal)
GND           →  Tombol PANIC kaki 2 (jangan ditahan saat power-on!)
GPIO2         →  Modul Relay 1 (pin IN) — LED biru bawaan modul ESP-01S (kalau ada) otomatis ikut nyala/mati di pin ini juga
3.3V / GND    →  Modul Relay 1 (VCC / GND — sesuai spek modul)
GPIO1 (TX)    →  Buzzer+ piezo (Serial dimatikan di firmware ini, jadi pin ini bebas dipakai)
GND           →  Buzzer-
GPIO3 (RX)    →  LED status tunggal + Resistor 220Ω (indikator via pola kedip, lihat komentar di kode)
GND           →  Katoda LED status`,
    components: ["1× ESP-01 (ESP8266)", "1× Modul USB-TTL 3.3V (khusus untuk upload firmware)", "1× Catu daya 3.3V terpisah min. 250mA (JANGAN andalkan pin 3.3V USB-TTL)", "1× Modul Relay 1 channel (3.3V/5V, aktif-LOW umumnya)", "1× Tombol tekan (push button)", "1× Buzzer piezo kecil", "1× LED + Resistor 220Ω (status tunggal)", "Breadboard + kabel jumper"],
  },
  esp32c3: {
    label: "ESP32-C3",
    shortLabel: "ESP32-C3",
    boardManagerName: "ESP32C3 Dev Module (via board package \"esp32\" by Espressif Systems)",
    uploadSpeed: "921600",
    extraNotes: "Install dulu board package-nya: File → Preferences → \"Additional Board Manager URLs\" isi https://espressif.github.io/arduino-esp32/package_esp32_index.json, lalu Tools → Board → Board Manager → cari \"esp32\" → Install. Kebanyakan board ESP32-C3 punya USB native (langsung colok, tanpa chip USB-TTL terpisah) — pastikan opsi Tools → \"USB CDC On Boot\" di-ENABLE supaya Serial Monitor & upload lewat USB langsung berfungsi. Sebagian board (mis. DevKitM-1 resmi) punya LED bawaan tipe RGB (WS2812) bukan LED biasa — cek tipe LED board Anda kalau indikator Relay 1 tidak menyala (lihat catatan di dalam kode). WiFi & alamat server TIDAK hardcode lagi — tekan & tahan tombol BOOT bawaan ±3 detik (device sudah nyala normal) untuk buka portal setup: hotspot \"PanicButton-Setup\" (password: setup1234), buka 192.168.4.1 dari HP.",
    wiring: `ESP32-C3  →  Komponen
─────────────────────────────────────
(bawaan)      →  Tombol BOOT board = Tombol PANIC (GPIO9, TIDAK PERLU wiring tambahan)
(bawaan)      →  LED board = Indikator Relay 1 (GPIO8, otomatis — cek tipe LED, lihat catatan)
GPIO4         →  Modul Relay 1 (pin IN)
3.3V/5V + GND →  Modul Relay 1 (VCC / GND — sesuai spek modul relay Anda)
GPIO5         →  Buzzer+ piezo
GND           →  Buzzer-
GPIO6         →  LED Merah (220Ω)
GPIO7         →  LED Hijau (220Ω)
GPIO10        →  LED Kuning (220Ω)
GND           →  Katoda semua LED`,
    components: ["1× ESP32-C3 Dev Board (DevKitM-1 / SuperMini / sejenis)", "1× Modul Relay 1 channel (aktif-LOW umumnya)", "1× Buzzer piezo 5V", "1× LED merah, 1× LED hijau, 1× LED kuning", "3× Resistor 220Ω", "Breadboard + kabel jumper", "(Tombol PANIC & LED indikator relay pakai yang sudah bawaan board — tidak perlu beli)"],
  },
};

function Section({ title, icon: Icon, children, defaultOpen = false }: { title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/50 transition-colors cursor-pointer">
        <div className="flex items-center gap-3"><Icon className="size-4 text-primary" /><span className="font-bold text-sm text-foreground">{title}</span></div>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  );
}

export default function FirmwarePage() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardType>("wemosd1");
  const [deviceType, setDeviceType] = useState<"personal" | "community">("personal");
  const exampleDeviceId = deviceType === "community" ? "WD1-C-XXXXXXXX" : "WD1-XXXXXXXX";
  const examplePairingCode = "ABCDEF";
  const firmwareCode = generateFirmware(exampleDeviceId, examplePairingCode, deviceType, board);
  const meta = BOARD_META[board];

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/devices")} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer"><ArrowLeft className="size-5 text-foreground" /></button>
        <div className="flex-1">
          <h1 className="font-bold text-foreground flex items-center gap-2"><Cpu className="size-4 text-primary" /> Firmware {meta.shortLabel}</h1>
          <p className="text-xs text-muted-foreground">Kode Arduino + Panduan Pemasangan</p>
        </div>
      </div>

      <motion.div className="max-w-3xl mx-auto px-4 py-6 space-y-4" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-sm text-yellow-400">Sebelum Upload Firmware</p>
            <p className="text-xs text-muted-foreground">Ganti <code className="text-yellow-400 bg-yellow-500/10 px-1 rounded">DEVICE_ID</code> dan <code className="text-yellow-400 bg-yellow-500/10 px-1 rounded">PAIRING_CODE</code> dengan nilai dari halaman <button onClick={() => navigate("/devices")} className="text-primary underline cursor-pointer">Perangkat</button>. Juga ubah WiFi, <code className="text-yellow-400 bg-yellow-500/10 px-1 rounded">SERVER_URL</code>, dan <code className="text-yellow-400 bg-yellow-500/10 px-1 rounded">SERVER_HOST</code> (isinya sama, cuma yang kedua tanpa "https://").</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="font-bold text-sm text-foreground">Board</p>
          <div className="flex gap-2">
            {(Object.keys(BOARD_META) as BoardType[]).map((b) => (
              <button
                key={b}
                onClick={() => setBoard(b)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${board === b ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border border-border"}`}
              >
                {BOARD_META[b].shortLabel}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {board === "nodemcu"
              ? "NodeMCU punya tombol FLASH & LED biru bawaan yang dimanfaatkan sebagai tombol PANIC dan indikator Relay 1, plus tambahan output Relay 1 untuk perangkat eksternal (sirine/strobo/solenoid)."
              : board === "esp32c3"
                ? "ESP32-C3 punya tombol BOOT & LED bawaan yang dimanfaatkan sama seperti NodeMCU (tombol PANIC + indikator Relay 1) — beda chip, jadi library WiFi/HTTP-nya juga beda dari 3 board ESP8266 lainnya."
                : board === "esp01"
                  ? "ESP-01 cuma punya 4 GPIO. Firmware ini memaksimalkan semuanya (tombol, buzzer, relay, 1 LED status) dengan mengorbankan Serial debug — baca catatan pemasangan di bawah sebelum upload."
                  : "Pinout & kode asli yang sudah terbukti jalan — tidak diubah."}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[{ label: "Board", value: meta.label, icon: Cpu }, { label: "Runtime", value: "Arduino IDE", icon: Terminal }, { label: "Protocol", value: "HTTPS REST", icon: Wifi }].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-3 text-center space-y-1">
              <Icon className="size-4 text-primary mx-auto" />
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xs font-bold text-foreground">{value}</p>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="font-bold text-sm text-foreground">Tipe Device</p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeviceType("personal")}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${deviceType === "personal" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border border-border"}`}
            >
              Personal (Milik Sendiri)
            </button>
            <button
              onClick={() => setDeviceType("community")}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${deviceType === "community" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border border-border"}`}
            >
              Komunal (Pos/RT/RW/Fasum)
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {deviceType === "community"
              ? "Device komunal memicu alarm ATAS NAMA LOKASI (mis. \"Pos Satpam Blok A\"), bukan atas nama orang. Daftarkan dulu di halaman Perangkat → \"Device Komunal (Admin)\" untuk dapat DEVICE_ID & PAIRING_CODE-nya."
              : "Device personal memicu alarm milik pemiliknya sendiri, sama seperti menekan tombol di aplikasi."}
          </p>
        </div>

        <Section title="Firmware Arduino (.ino)" icon={Terminal} defaultOpen>
          <CodeBlock code={firmwareCode} language="C++ (Arduino)" />
        </Section>

        <Section title="Bagaimana Device Ini Bisa Bunyi untuk Alarm Orang/Lokasi Lain?" icon={AlertTriangle}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Setiap device — personal maupun komunal — long-poll status yang SAMA (<code className="text-primary">/wemos/alarm/status/longpoll</code>).
            Device akan berbunyi kalau dirinya termasuk dalam <b>daftar target</b> alarm yang sedang aktif, siapa pun/apa pun pemicunya.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Daftar target ini diatur di aplikasi (halaman Perangkat → "Target Alarm" untuk personal, atau "Atur target alarm lokasi ini" untuk device komunal) — <b>bukan</b> di kode firmware, jadi bisa diubah kapan saja tanpa upload ulang.
          </p>
          <ul className="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1">
            <li><b>Default Panic/Silent:</b> semua device (pribadi + komunal grup) ikut bunyi.</li>
            <li><b>Default Mode Kawal:</b> tidak ada device yang bunyi (app-only) — supaya jalan pulang malam tidak bikin geger satu RT.</li>
            <li><b>Default tombol fisik komunal:</b> semua device di grup yang sama ikut bunyi (siaran ke seluruh lokasi).</li>
          </ul>
        </Section>

        <Section title="Kenapa Long-Poll, Bukan Polling Biasa?" icon={Wifi}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Firmware ini pakai <b>hybrid long-polling</b>: request ke server DITAHAN (tidak langsung dijawab) sampai
            maksimal ~25 detik, kecuali ada alarm — kalau ada, server jawab <b>saat itu juga</b> (nyaris instan).
            Dibanding polling pendek tiap 2 detik, ini memangkas jumlah request device secara drastis
            (~8× lebih sedikit) tanpa mengorbankan kecepatan deteksi alarm.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Satu hal penting yang sudah ditangani di firmware ini: <b>tombol fisik tetap dicek tiap ~20 milidetik</b>
            walau koneksi long-poll sedang "menggantung" menunggu jawaban server — jadi menekan tombol PANIC tidak
            pernah terasa delay, walau request sedang ditahan puluhan detik di background.
          </p>
        </Section>

        <Section title="Skema Rangkaian (Wiring)" icon={Zap} defaultOpen>
          <CodeBlock code={meta.wiring} language="wiring diagram" />
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-foreground">Komponen yang dibutuhkan:</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              {meta.components.map((item) => (
                <li key={item} className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />{item}</li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="Instalasi Library Arduino" icon={Download}>
          <div className="space-y-2">
            {[{ name: "ESP8266 Board Package", notes: "Tools → Board → Board Manager → cari 'esp8266' → Install" }, { name: "ArduinoJson v6", notes: "Library Manager → cari 'ArduinoJson'" }].map(({ name, notes }) => (
              <div key={name} className="bg-background rounded-xl p-3">
                <p className="font-bold text-sm text-foreground">{name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{notes}</p>
              </div>
            ))}
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 space-y-1">
              <p className="text-xs font-bold text-primary">Pengaturan Upload:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>Board: <span className="text-foreground">{meta.boardManagerName}</span></li>
                <li>Upload Speed: <span className="text-foreground">{meta.uploadSpeed}</span></li>
              </ul>
            </div>
            {meta.extraNotes && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-1">
                <p className="text-xs font-bold text-yellow-400">Catatan Khusus {meta.shortLabel}:</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{meta.extraNotes}</p>
              </div>
            )}
          </div>
        </Section>
      </motion.div>
    </div>
  );
}
