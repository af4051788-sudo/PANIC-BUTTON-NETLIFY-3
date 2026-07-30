# Fase 6: Bukti Otomatis + QR Scanner — Cara Pasang & Test

## File Baru
- `convex/evidence.ts` — backend bukti alarm (upload URL, attach, query gated, delete)
- `src/hooks/use-evidence-capture.ts` — capture foto/audio/video via browser
- `src/components/qr-scanner.tsx` — scanner QR reusable (pakai `jsqr`)

## File yang Diubah
- `convex/schema.ts` — `users` dapat 3 field preferensi bukti; tabel baru `alarmEvidence`
- `convex/users.ts` — `updateProfile` terima field preferensi bukti
- `src/pages/profile/page.tsx` — UI toggle "Bukti Otomatis Saat Panic"
- `src/pages/Index.tsx` — panggil capture setelah alarm berhasil terkirim; komponen `AlarmEvidenceViewer` baru
- `src/pages/community/page.tsx` — QR untuk invite grup (tampil saat buat grup & di detail grup) + scan-to-join
- `src/pages/devices/page.tsx` — tombol "Scan QR Device" untuk lookup cepat deviceId/pairingCode
- `package.json` — tambah dependency `jsqr`

## Langkah Pasang

```bash
pnpm install   # menarik jsqr
npx convex dev # sync schema baru
pnpm dev
```

⚠️ **Kamera/mikrofon HANYA jalan di HTTPS atau `localhost`** — batasan browser,
bukan bug kode. Kalau test di jaringan lokal pakai IP (`http://192.168.x.x`),
browser akan menolak `getUserMedia` walau izin sudah di-allow sebelumnya.
Gunakan `pnpm build && pnpm preview` lalu akses lewat `localhost`, atau deploy
dulu ke Netlify/Vercel (otomatis HTTPS) untuk test di HP asli.

## Cara Test

### Bukti Otomatis
1. Profil → aktifkan "Bukti Otomatis Saat Panic" → pilih Foto & Audio → simpan
2. Tekan panic button (tahan 3 detik)
3. Browser akan **dua kali** minta izin terpisah (kamera untuk foto, mikrofon
   untuk audio) — izinkan keduanya
4. Setelah beberapa detik, scroll ke bawah tombol utama → bukti foto & audio
   player harus muncul di bawah tombol responder
5. Coba tolak salah satu izin (misal mikrofon) → alarm tetap terkirim normal,
   cuma foto yang muncul, audio tidak — konfirmasi tidak saling menggagalkan
6. Login sebagai anggota grup lain (belum merespon) → bukti TIDAK BOLEH
   terlihat sampai mereka tekan "Saya Merespon"

### QR Scanner — Join Grup
1. Buat grup baru → QR harus muncul di modal sukses
2. Login sebagai user lain, buka "Gabung Grup" → "Scan QR Undangan" →
   arahkan kamera ke QR dari langkah 1 → harus auto-join tanpa perlu ketik manual
3. Buka grup yang sudah ada → ikon QR di header → harus bisa ditampilkan ulang

### QR Scanner — Device
1. Halaman Perangkat → ikon QR di header → scan QR device (dari QRModal
   pairing device manapun) → harus muncul Device ID + Pairing Code siap-copy

## Catatan Privasi & Desain
- Kamera/mic **selalu dimatikan (`stream.getTracks().stop()`)** segera setelah
  capture selesai — tidak ada rekaman berkelanjutan, sesuai durasi yang di-set.
- Evidence capture GAGAL (izin ditolak/browser tidak dukung) tidak pernah
  menggagalkan alarm — murni bonus, bukan syarat.
- Akses lihat bukti dibatasi di server: pemilik, responder yang sudah
  menekan "Saya Merespon", atau admin grup — bukan cuma disembunyikan di UI.
- QR invite grup pakai payload JSON `{"type":"group_invite","code":"ABC123"}`
  supaya scanner bisa membedakan dari QR device (`{"deviceId":...,"pairingCode":...}`).
