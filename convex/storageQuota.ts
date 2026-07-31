import { query, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Semua file di storage Convex project ini adalah bukti (foto/audio/video)
 * — lihat convex/schema.ts, tidak ada tabel lain yang pakai v.id("_storage").
 * Jadi total ukuran tabel sistem `_storage` = total pemakaian oleh bukti.
 *
 * PENTING — kuota ini GLOBAL untuk SELURUH project (semua grup, semua user
 * gabung jadi satu angka), BUKAN per-user/per-grup. Convex memang tidak
 * punya kuota bawaan per-user — penyimpanan file dihitung untuk satu
 * deployment secara keseluruhan.
 *
 * Angka di bawah ini SENGAJA dibuat konservatif untuk Convex Free/Starter
 * plan (limit asli biasanya sekitar 1 GB, tapi cek angka PASTI di Convex
 * Dashboard → Usage → File Storage, karena bisa berubah). Kita sisakan
 * banyak jarak aman (bukan mepet ke limit asli) supaya:
 * 1. Tidak pernah kena error upload gagal total dari Convex-nya sendiri.
 * 2. ⚠️ CATATAN SKALA: kalau nanti dipakai 600+ pengguna (20 grup × 30
 *    anggota) dengan bukti foto/video otomatis aktif, kuota se-kecil ini
 *    (masih di plan Free) SANGAT MUNGKIN penuh dalam hitungan hari, bahkan
 *    jam, saat pemakaian ramai — sistem auto-cleanup di bawah ini cuma
 *    mencegah aplikasi CRASH/gagal total, bukan menjamin bukti tersimpan
 *    lama. Untuk skala itu, upgrade ke Convex Professional (storage jauh
 *    lebih besar) sangat disarankan sebelum benar-benar dipakai banyak
 *    komunitas — naikkan angka di bawah ini sesuai limit plan baru kamu.
 */
export const MAX_STORAGE_BYTES = 400 * 1024 * 1024; // 400 MB (setengah dari estimasi limit Free ~1GB, jaga jarak aman)
const WARNING_THRESHOLD_PERCENT = 80;
// Target sisa setelah auto-cleanup — beri jarak aman biar tidak langsung
// mepet ke limit lagi begitu ada bukti baru masuk.
const CLEANUP_TARGET_PERCENT = 70;

async function getTotalEvidenceBytes(ctx: QueryCtx | MutationCtx): Promise<number> {
  const files = await ctx.db.system.query("_storage").collect();
  return files.reduce((sum, f) => sum + f.size, 0);
}

/**
 * Status kuota penyimpanan saat ini — dipakai UI untuk menampilkan banner
 * peringatan. Reaktif (live query), jadi banner otomatis muncul/hilang
 * tanpa perlu refresh begitu ukuran total berubah.
 */
export const getStorageStatus = query({
  args: {},
  handler: async (ctx) => {
    const usedBytes = await getTotalEvidenceBytes(ctx);
    const percentUsed = Math.min(100, Math.round((usedBytes / MAX_STORAGE_BYTES) * 100));
    return {
      usedBytes,
      maxBytes: MAX_STORAGE_BYTES,
      percentUsed,
      isWarning: percentUsed >= WARNING_THRESHOLD_PERCENT,
    };
  },
});

/**
 * Hapus BUKTI PALING LAMA satu per satu (bukan alarm-nya, cuma bukti/file-
 * nya) sampai penyimpanan turun ke target aman (70%). Tidak melakukan
 * apa-apa kalau masih di bawah limit.
 *
 * Dipanggil dari 2 tempat:
 * 1. Langsung (awaited) setiap ada bukti baru masuk — convex/evidence.ts.
 * 2. Cron harian sebagai jaring pengaman (enforceQuotaCron di bawah).
 */
export async function enforceQuota(ctx: MutationCtx): Promise<{ deletedCount: number }> {
  let usedBytes = await getTotalEvidenceBytes(ctx);
  if (usedBytes <= MAX_STORAGE_BYTES) return { deletedCount: 0 };

  const targetBytes = MAX_STORAGE_BYTES * (CLEANUP_TARGET_PERCENT / 100);

  // Urutkan dari yang paling lama direkam (capturedAt paling kecil = dihapus duluan).
  const allEvidence = await ctx.db.query("alarmEvidence").collect();
  allEvidence.sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));

  let deletedCount = 0;
  for (const e of allEvidence) {
    if (usedBytes <= targetBytes) break;
    const meta = await ctx.db.system.get(e.storageId);
    await ctx.storage.delete(e.storageId);
    await ctx.db.delete(e._id);
    usedBytes -= meta?.size ?? 0;
    deletedCount += 1;
  }
  return { deletedCount };
}

export const enforceQuotaCron = internalMutation({
  args: {},
  handler: async (ctx) => {
    await enforceQuota(ctx);
  },
});
