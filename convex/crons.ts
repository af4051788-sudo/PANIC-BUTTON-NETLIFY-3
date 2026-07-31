import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Setiap 5 menit: set device offline jika tidak ada heartbeat.
 * Memperbaiki celah di mana field isOnline tidak pernah di-reset ke false.
 */
crons.interval(
  "mark stale devices offline",
  { minutes: 5 },
  internal.scheduler.markStaleDevicesOffline,
  {},
);

/**
 * Auto-hapus bukti (foto/audio/video) berdasarkan KUOTA PENYIMPANAN — lihat
 * convex/storageQuota.ts. Riwayat alarm (teks) sengaja TIDAK di-auto-delete;
 * itu murni keputusan manual oleh user sendiri (lihat convex/alarms.ts:
 * deleteAlarm), karena riwayat ringan dan pemilik yang paling tahu kapan
 * datanya sudah tidak relevan lagi.
 */
crons.interval(
  "enforce evidence storage quota",
  { hours: 6 },
  internal.storageQuota.enforceQuotaCron,
  {},
);

export default crons;
