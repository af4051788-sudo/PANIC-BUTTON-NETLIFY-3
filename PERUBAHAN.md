# PANIC BUTTON — Ringkasan Perubahan (Fase 1-4)

Project ini sudah diperbaiki dari versi asli yang kamu upload. Semua perubahan
di bawah SUDAH tergabung langsung ke dalam kode — kamu tidak perlu
menggabungkan apa pun lagi secara manual, cukup ikuti langkah "Cara Menjalankan"
di paling bawah.

⚠️ **File `.env.local` yang asli (berisi kunci rahasia) TIDAK disertakan** di
paket ini — lihat bagian "Environment Variables" di bawah untuk mengisinya
kembali. Ini demi keamanan (kunci itu sempat ter-upload ke chat).

---

## Fase 1 — PWA Lengkap
- `public/manifest.json`, `public/sw.js`, `public/offline.html`, 13 ikon di `public/icons/`
- `index.html`: link manifest, theme-color, apple-touch-icon
- `src/hooks/use-service-worker.ts`: tombol "Perbarui" sekarang benar-benar mengaktifkan versi baru (skipWaiting), bukan cuma reload halaman lama

## Fase 2 — Web Push Notification
- `convex/schema.ts`: tabel baru `pushSubscriptions`
- `convex/push.ts`, `convex/pushSender.ts`: infrastruktur kirim push (pakai `web-push`)
- `convex/alarms.ts`, `convex/iot.ts`, `convex/groups.ts`: alarm (dari app, device, atau escort mode) sekarang kirim push ke anggota grup
- `public/sw.js`: handler `push` & `notificationclick`
- `src/hooks/use-push-notifications.ts`: hook subscribe/unsubscribe
- `src/pages/profile/page.tsx`: toggle "Notifikasi Alarm Grup"

## Fase 3 — Fallback WhatsApp ke Kontak Darurat
- `convex/schema.ts`: field `emergencyContactNotifiedAt` di tabel alarms (audit, anti-double-send)
- `convex/notifyContact.ts`: kirim WA via Fonnte, hormati setting Privasi Lokasi
- `convex/alarms.ts`, `convex/iot.ts`: jadwalkan WA 15 detik setelah alarm panic/silent tidak di-resolve
- `convex/scheduler.ts`: escort mode yang auto-eskalasi (6 menit) juga kirim WA

## Fase 4 — Rate Limiting
- `convex/convex.config.ts`, `convex/rateLimiting.ts`: component resmi `@convex-dev/rate-limiter`
- `convex/alarms.ts` (`triggerAlarm`), `convex/groups.ts` (`joinGroup`, `startEscortMode`): dibatasi per-user
- `convex/iot.ts` (4 mutation): dibatasi per-`deviceId`
- `convex/http.ts`: balas HTTP 429 kalau device kena rate limit

---

## Environment Variables yang Perlu Kamu Isi

Copy `.env.local.example` jadi `.env.local`, lalu isi:

| Variable | Cara dapatkan |
|---|---|
| `JWT_PRIVATE_KEY` | Jalankan `npx @convex-dev/auth` — otomatis generate & isi sendiri |
| `SITE_URL` | URL app kamu (`http://localhost:5173` untuk lokal) |
| `VITE_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `VITE_CONVEX_SITE_URL` | Otomatis diisi saat kamu jalankan `npx convex dev` pertama kali |
| `VITE_VAPID_PUBLIC_KEY` | Generate: `npx web-push generate-vapid-keys` (public key aman dibagi) |

Lalu di **Convex Dashboard → Settings → Environment Variables** (bukan file lokal, ini rahasia server):

| Variable | Cara dapatkan |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Dari perintah `web-push generate-vapid-keys` yang sama di atas |
| `VAPID_SUBJECT` | Email kontak kamu, format `mailto:kamu@domain.com` |
| `FONNTE_TOKEN` | Daftar di fonnte.com, scan QR pakai nomor WA cadangan, copy token dari dashboard |

---

## Cara Menjalankan

```bash
pnpm install

# Terminal 1 — biarkan tetap jalan
npx convex dev

# Terminal 2
pnpm dev
```

Buka `http://localhost:5173`.

Untuk test PWA/service worker (Fase 1), harus pakai production build:
```bash
pnpm build
pnpm preview
```

---

## Yang Belum Dikerjakan (Roadmap Lanjutan)
- Fase 5: HMAC signing untuk autentikasi device IoT (perlu update firmware ESP8266/ESP32 juga)
- Fase 6: Observability (Sentry) + audit log
- Fase 7: Fitur komunitas lanjutan (check-in aman, geofencing, dll)
