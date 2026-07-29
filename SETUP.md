# Setup PANIC BUTTON (Tanpa External Auth)

Auth sekarang **mandiri** menggunakan Convex Auth (email + password).
Tidak perlu Hercules, OIDC, atau layanan auth pihak ketiga.

---

## Langkah 1 — Install Dependencies

```bash
pnpm install
```

---

## Langkah 2 — Setup Convex

Jalankan Convex pertama kali untuk mendapatkan URL project:

```bash
npx convex dev
```

Ikuti petunjuknya. Setelah selesai, Convex akan otomatis menulis `VITE_CONVEX_URL` ke `.env.local`.

---

## Langkah 3 — Set Environment Variables di Convex Dashboard

Buka https://dashboard.convex.dev → Project → Settings → Environment Variables, tambahkan:

| Variable         | Value                              |
|------------------|------------------------------------|
| `JWT_PRIVATE_KEY` | Isi dari `.env.local` (private key RSA) |
| `SITE_URL`       | `http://localhost:5173` (atau domain production) |

> File `.env.local` sudah berisi `JWT_PRIVATE_KEY` yang di-generate otomatis.
> Salin nilainya ke Convex dashboard agar backend bisa verifikasi JWT.

---

## Langkah 4 — Jalankan Aplikasi

Di terminal 1 (backend Convex):
```bash
npx convex dev
```

Di terminal 2 (frontend Vite):
```bash
pnpm dev
```

Buka http://localhost:5173

---

## Cara Kerja Auth Baru

| Lama (Hercules OIDC) | Baru (Convex Auth) |
|---|---|
| Redirect ke external provider | Form login/register inline (modal) |
| Butuh env vars OIDC | Hanya butuh `JWT_PRIVATE_KEY` + `SITE_URL` |
| Callback page `/auth/callback` | Tidak diperlukan |
| `useAuth()` dari `@usehercules/auth` | `useAuthActions()` dari `@convex-dev/auth/react` |
| `tokenIdentifier` di DB | User ID langsung dari `getAuthUserId(ctx)` |

---

## Fitur Login

- **Daftar akun baru** — email + password + nama lengkap
- **Masuk** — email + password
- **Keluar** — tombol di halaman Profil
- Modal login muncul saat user menekan tombol "Masuk" di halaman utama
