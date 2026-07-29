# Fase 5: Jaringan Wemos Multi-Device (Personal + Komunal) — Cara Pasang & Test

## Ringkasan Arsitektur (hasil kesepakatan diskusi)

1. **Device Komunal** (Pos Satpam/Kantor RT/RW/Fasum) — tipe device baru, terikat
   ke GRUP bukan ke satu orang. Tombol fisiknya memicu alarm atas nama LOKASI
   ("Pos Satpam Blok A menekan alarm"), bukan atas nama orang.
2. **Target Alarm** — setiap user (dan setiap device komunal) punya daftar
   "device mana saja yang ikut bunyi", diatur SEKALI di halaman Perangkat,
   otomatis dipakai tiap kali panic ditekan (tidak ada langkah tambahan saat darurat).
3. **Tidak ada mode "Global" terpisah** — itu cuma titik ekstrem dari daftar
   target yang sama (centang semua = seperti "global").
4. **Default berbeda per jenis alarm**:
   - Panic/Silent → default: SEMUA device (pribadi + komunal grup) menyala
   - Escort → default: TIDAK ADA device menyala (app-only)
   - Tombol fisik device komunal → default: semua device di grup yang sama menyala

## File Baru
- `convex/alarmTargets.ts` — inti resolusi target device (lihat komentar di dalamnya)
- `convex/communityDevices.ts` — CRUD device komunal (admin grup only)

## File yang Diubah
- `convex/schema.ts` — tabel `devices` dapat `deviceType`/`locationLabel`/`groupId`;
  tabel `alarms` dapat `targetDeviceIds`/`isLocationTriggered`/`triggerLocationLabel`;
  tabel baru `alarmTargetPreferences`
- `convex/devices.ts` — `getMyDevices` sekarang exclude device komunal; ownership
  check ditambahkan ke `deleteDevice`/`regeneratePairingCode` (sebelumnya bolong —
  siapa saja bisa hapus/reset device orang lain, sekarang sudah dibatasi pemilik)
- `convex/alarms.ts` — `triggerAlarm` hitung `targetDeviceIds`; **`resolveAlarm`
  diperbaiki** (sebelumnya SIAPA SAJA bisa mematikan alarm siapa saja — bug
  keamanan pre-existing, sekarang hanya pemilik atau admin grup yang bisa)
- `convex/groups.ts` — `startEscortMode` hitung target; `getMyGroupActiveAlarms`
  tampilkan nama lokasi untuk alarm komunal
- `convex/iot.ts` — **ditulis ulang total**: polling `getAlarmStatus` sekarang
  cek "apakah device ini di-target alarm manapun" (bukan cuma cek alarm
  pemiliknya sendiri) + 2 mutation baru untuk device komunal
- `convex/http.ts` — 2 endpoint baru: `/wemos/community/alarm/on` & `/off`
- `convex/push.ts` — helper baru `resolveGroupWideRecipients`
- `convex/admin.ts` — dashboard admin platform tampilkan nama lokasi juga
- `src/pages/devices/page.tsx` — bagian baru "Target Alarm" + "Device Komunal (Admin)"
- `src/pages/firmware/page.tsx` — toggle Personal/Komunal, firmware `pollAlarmStatus()`
  **diperbaiki** (sebelumnya tidak akan pernah bunyi untuk alarm orang lain sama
  sekali — sekarang benar-benar bisa jadi "receiver" untuk alarm siapa pun yang menargetkannya)
- `src/hooks/use-alarm-context.tsx`, `src/pages/Index.tsx` — field `isLocationTriggered`

## Langkah Pasang

### 1. Salin semua file di atas ke project asli kamu

### 2. Sync schema & functions baru
```bash
npx convex dev
```
Perhatikan: ini migrasi schema yang cukup besar (tabel baru + field baru).
Kalau ada alarm/device lama yang sedang aktif saat migrasi, sebaiknya
resolve/hapus dulu sebelum sync untuk menghindari kebingungan data lama vs baru.

### 3. Update & re-flash firmware SEMUA Wemos yang sudah terpasang
Ini **wajib** — firmware lama tidak pernah benar-benar bisa jadi "receiver"
untuk alarm orang lain (ada bug `if (currentState == STATE_IDLE) return;` di
awal `pollAlarmStatus()` yang mencegahnya). Ambil kode baru dari halaman
Firmware, pilih tipe "Personal" untuk device existing punya user, lalu upload ulang.

## Cara Test Bertahap

### Test A — Personal device tetap seperti biasa (regresi)
1. Device A (personal, milik User 1) — pastikan masih bisa trigger alarm sendiri lewat tombol fisik, dan masih bisa dimatikan dengan lepas tombol.
2. Cek halaman Perangkat User 1 → "Target Alarm" → tab Panic/Silent → harus terlihat device A sendiri tercentang secara default (belum di-customize).

### Test B — Personal device jadi target orang lain (inti fitur baru)
1. User 1 dan User 2 satu grup. User 1 punya Device A (personal).
2. User 2 buka halaman Perangkat → Target Alarm → tab Panic/Silent → **harus
   terlihat Device A milik User 1** di checklist (karena default = semua
   device komunal + device sendiri — device A adalah device PRIBADI User 1,
   jadi TIDAK otomatis masuk ke daftar target User 2 kecuali User 2 juga
   admin/bagian grup yang sama dengan device komunal. Device pribadi orang
   lain TIDAK PERNAH masuk default siapa pun kecuali dipilih manual).

   ⚠️ **Catatan desain penting**: default "semua device" untuk kategori
   panic_silent HANYA mencakup device PRIBADI MILIK SENDIRI + device KOMUNAL
   grup. Device pribadi orang lain tidak akan pernah otomatis ikut bunyi
   (untuk mencegah kejutan privasi — device di rumah User 1 tidak akan bunyi
   otomatis cuma karena User 2 panic, kecuali User 1 atau admin memang mau
   men-daftarkan Device A sebagai device KOMUNAL).

### Test C — Device Komunal (fitur utama yang diminta)
1. Buka halaman Perangkat sebagai **admin grup** → scroll ke "Device Komunal (Admin)"
2. Daftarkan device baru: "Pos Satpam Blok A" → dapat DEVICE_ID + PAIRING_CODE baru
3. Flash Wemos baru dengan firmware tipe **Komunal**, isi DEVICE_ID/PAIRING_CODE dari langkah 2
4. Nyalakan device, tunggu heartbeat pertama (cek status online di halaman Perangkat)
5. Tekan tombol fisik di Wemos ini (tahan 3 detik = panic)
6. Yang harus terjadi:
   - Semua anggota grup dapat push notif "🚨 Alarm Darurat Lokasi — Pos Satpam Blok A memicu alarm..."
   - Dashboard app semua anggota menampilkan banner "📍 Pos Satpam Blok A" (bukan nama orang)
   - Device-device lain yang termasuk target (default: semua device di grup yang sama) mulai berbunyi dalam ±2 detik (siklus polling)
   - Anggota bisa tekan "Saya Merespon" seperti alarm biasa

### Test D — Kustomisasi Target (fitur "lokal" vs "seolah global")
1. Di halaman Perangkat, buka "Atur target alarm lokasi ini" untuk Pos Satpam Blok A
2. Uncheck semua device KECUALI 1 (misal cuma "Kantor RT")
3. Simpan, lalu tekan tombol fisik Pos Satpam lagi
4. Yang harus terjadi: HANYA Wemos "Kantor RT" yang bunyi, device lain (termasuk yang sebelumnya ikut bunyi) TIDAK bunyi — App tetap dapat notifikasi (jalur app-to-app tidak pernah terputus oleh pengaturan ini)

### Test E — Escort mode tetap senyap ke hardware (default)
1. User mulai mode kawal dari app
2. Pastikan TIDAK ADA Wemos manapun yang bunyi (default escort = kosong)
3. Cek halaman Perangkat → Target Alarm → tab "Mode Kawal" → checklist harus kosong secara default

## Keterbatasan yang Diketahui (belum sempurna, transparan ke kamu)
- Kalau admin yang MENDAFTARKAN device komunal kebetulan membuka app saat
  device itu memicu alarm, tombol utama app-nya bisa ikut menampilkan status
  "alarm aktif" generik (karena field `userId` teknis alarm memang tetap
  merujuk ke admin tsb). Ini kosmetik saja — tidak memengaruhi fungsi alarm/
  notifikasi/target sama sekali, cuma tampilan tombol utama admin itu sendiri
  kurang pas kalau ini terjadi. Bisa diperbaiki di iterasi berikutnya kalau perlu.
- `getMyGroupsCommunityDevices` (query bantuan) sudah dibuat tapi belum
  dipakai di UI manapun — tersedia untuk pengembangan fitur lanjutan.
