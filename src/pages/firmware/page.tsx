import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft, Copy, Check, Cpu, Zap, Wifi, AlertTriangle,
  ChevronDown, ChevronUp, Terminal, BookOpen, Download,
} from "lucide-react";

function generateFirmware(deviceId: string, pairingCode: string, deviceType: "personal" | "community" = "personal"): string {
  const alarmOnPath = deviceType === "community" ? "/wemos/community/alarm/on" : "/wemos/alarm/on";
  const alarmOffPath = deviceType === "community" ? "/wemos/community/alarm/off" : "/wemos/alarm/off";
  return `/*
 * PANIC BUTTON - Firmware Wemos D1 Mini (ESP8266)
 * Mode: ${deviceType === "community" ? "COMMUNITY (Pos Satpam/Kantor RT-RW/Fasum)" : "PERSONAL (device pribadi)"}
 * Ganti WIFI_SSID, WIFI_PASSWORD, DEVICE_ID, PAIRING_CODE
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <ArduinoJson.h>

const char* WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* DEVICE_ID     = "${deviceId}";
const char* PAIRING_CODE  = "${pairingCode}";
const char* SERVER_URL    = "https://YOUR-CONVEX-SITE.convex.site";
const char* SERVER_HOST   = "YOUR-CONVEX-SITE.convex.site"; // sama seperti SERVER_URL tapi TANPA "https://" — dipakai long-poll

const int PIN_BUTTON  = D3;
const int PIN_BUZZER  = D5;
const int PIN_LED_R   = D6;
const int PIN_LED_G   = D7;
const int PIN_LED_Y   = D8;

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

enum AlarmState { STATE_IDLE, STATE_COUNTDOWN, STATE_ALARM_ACTIVE, STATE_SILENT_ACTIVE, STATE_ESCALATED };
AlarmState currentState = STATE_IDLE;

bool     buttonPressed   = false;
bool     prevButtonState = HIGH;
unsigned long pressStartMs = 0;
unsigned long lastHeartbeatMs = 0;
int      tapCount = 0;
unsigned long lastTapMs = 0;
bool     escalated = false;

bool httpPost(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  BearSSL::WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + path)) return false;
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
  if (!http.begin(client, String(SERVER_URL) + path)) return false;
  http.setTimeout(6000);
  int code = http.GET();
  if (code == 200) { response = http.getString(); http.end(); return true; }
  http.end(); return false;
}

void setLed(bool r, bool g, bool y) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_Y, y ? HIGH : LOW);
}

void sendHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID; doc["pairingCode"] = PAIRING_CODE; doc["wifi"] = WiFi.RSSI();
  String body, response; serializeJson(doc, body);
  httpPost("/wemos/heartbeat", body, response);
}

void sendAlarmOn(const char* type) {
  // ${deviceType === "community" ? "Endpoint KOMUNAL — memicu alarm atas nama LOKASI ini, bukan atas nama orang." : "Endpoint PERSONAL — memicu alarm milik pemilik device ini."}
  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID; doc["pairingCode"] = PAIRING_CODE; doc["type"] = type;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOnPath}", body, response);
}

void sendAlarmOff() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID; doc["pairingCode"] = PAIRING_CODE;
  String body, response; serializeJson(doc, body);
  httpPost("${alarmOffPath}", body, response);
}

void sendEscalation() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID; doc["pairingCode"] = PAIRING_CODE;
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

  if (!client.connect(SERVER_HOST, 443)) { delay(500); return; }

  String path = "/wemos/alarm/status/longpoll?deviceId="; path += DEVICE_ID; path += "&pairingCode="; path += PAIRING_CODE;
  client.print(String("GET ") + path + " HTTP/1.1\r\n" +
               "Host: " + SERVER_HOST + "\r\n" +
               "Connection: close\r\n\r\n");

  unsigned long waitStart = millis();
  while (client.connected() && !client.available()) {
    // Kunci dari desain ini: tombol fisik TETAP dicek tiap ~20ms walau
    // sedang menunggu server, jadi panic button tidak pernah "nge-lag"
    // walau request-nya ditahan sampai puluhan detik di sisi server.
    handleButton();
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
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int a = 0;
  while (WiFi.status() != WL_CONNECTED && a < 40) { delay(500); a++; setLed(false,false,true); delay(200); setLed(false,false,false); }
  if (WiFi.status() == WL_CONNECTED) { sendHeartbeat(); lastHeartbeatMs = millis(); }
  setLed(false, true, false);
  Serial.println("READY - Device: " + String(DEVICE_ID));
}

void loop() {
  unsigned long now = millis();
  handleButton();
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
  const [deviceType, setDeviceType] = useState<"personal" | "community">("personal");
  const exampleDeviceId = deviceType === "community" ? "WD1-C-XXXXXXXX" : "WD1-XXXXXXXX";
  const examplePairingCode = "ABCDEF";
  const firmwareCode = generateFirmware(exampleDeviceId, examplePairingCode, deviceType);

  const wiring = `Wemos D1 Mini  →  Komponen
─────────────────────────────────────
D3 (GPIO 0)   →  Tombol PANIC kaki 1
GND           →  Tombol PANIC kaki 2 (PULLUP active LOW)
D5 (GPIO 14)  →  Buzzer+ piezo
GND           →  Buzzer-
D6 (GPIO 12)  →  LED Merah (220Ω)
D7 (GPIO 13)  →  LED Hijau (220Ω)
D8 (GPIO 15)  →  LED Kuning (220Ω)
GND           →  Katoda semua LED`.trim();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/devices")} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer"><ArrowLeft className="size-5 text-foreground" /></button>
        <div className="flex-1">
          <h1 className="font-bold text-foreground flex items-center gap-2"><Cpu className="size-4 text-primary" /> Firmware Wemos D1</h1>
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

        <div className="grid grid-cols-3 gap-3">
          {[{ label: "Board", value: "Wemos D1 Mini", icon: Cpu }, { label: "Runtime", value: "Arduino IDE", icon: Terminal }, { label: "Protocol", value: "HTTPS REST", icon: Wifi }].map(({ label, value, icon: Icon }) => (
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
          <CodeBlock code={wiring} language="wiring diagram" />
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-foreground">Komponen yang dibutuhkan:</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              {["1× Wemos D1 Mini (ESP8266)", "1× Tombol tekan (push button)", "1× Buzzer piezo 5V", "1× LED merah, 1× LED hijau, 1× LED kuning", "3× Resistor 220Ω", "Breadboard + kabel jumper"].map((item) => (
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
                <li>Board: <span className="text-foreground">LOLIN(WEMOS) D1 R2 {"&"} mini</span></li>
                <li>Upload Speed: <span className="text-foreground">921600</span></li>
              </ul>
            </div>
          </div>
        </Section>
      </motion.div>
    </div>
  );
}
