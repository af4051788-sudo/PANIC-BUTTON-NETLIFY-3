import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { enforceQuota } from "./storageQuota";

/** Client calls this first to get a short-lived URL it can POST the captured blob to. */
export const generateEvidenceUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    return await ctx.storage.generateUploadUrl();
  },
});

/** After uploading the blob, client calls this to attach it to the alarm. */
export const attachEvidenceToAlarm = mutation({
  args: {
    alarmId: v.id("alarms"),
    storageId: v.id("_storage"),
    type: v.union(v.literal("photo"), v.literal("audio"), v.literal("video")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) throw new ConvexError({ message: "Alarm tidak ditemukan.", code: "NOT_FOUND" });
    // Hanya pemilik alarm yang boleh melampirkan bukti miliknya sendiri —
    // ini bukti PRIBADI orang yang menekan panic, bukan sesuatu yang orang
    // lain bisa "titipkan" ke alarm siapa pun.
    if (alarm.userId !== userId) {
      throw new ConvexError({ message: "Anda tidak memiliki izin untuk alarm ini.", code: "FORBIDDEN" });
    }

    await ctx.db.insert("alarmEvidence", {
      alarmId: args.alarmId,
      userId,
      type: args.type,
      storageId: args.storageId,
      capturedAt: new Date().toISOString(),
    });

    // Cek kuota SETIAP kali ada bukti baru masuk — kalau sudah lewat batas,
    // langsung hapus yang paling lama (termasuk mungkin bukti yang baru saja
    // masuk ini, kalau memang itu yang paling lama secara relatif — walau
    // secara praktis hampir tidak pernah terjadi karena bukti baru selalu
    // paling baru capturedAt-nya).
    await enforceQuota(ctx);
  },
});

/**
 * Bukti hanya bisa dilihat oleh: pemilik alarm sendiri, anggota yang sudah
 * merespon alarm ini, atau admin grup terkait — sama seperti gating lokasi,
 * supaya rekaman pribadi tidak bocor ke orang yang tidak relevan.
 */
export const getAlarmEvidence = query({
  args: { alarmId: v.id("alarms") },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ id: string; type: string; url: string | null; capturedAt: string }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) return [];

    let allowed = alarm.userId === userId;

    if (!allowed) {
      const myResponse = await ctx.db
        .query("alarmResponses")
        .withIndex("by_alarm_and_user", (q) => q.eq("alarmId", args.alarmId).eq("responderId", userId))
        .unique();
      allowed = !!myResponse;
    }

    if (!allowed && alarm.groupId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_and_user", (q) => q.eq("groupId", alarm.groupId!).eq("userId", userId))
        .unique();
      allowed = membership?.role === "admin";
    }

    if (!allowed) return [];

    const evidence = await ctx.db
      .query("alarmEvidence")
      .withIndex("by_alarm", (q) => q.eq("alarmId", args.alarmId))
      .collect();

    const results: Array<{ id: string; type: string; url: string | null; capturedAt: string }> = [];
    for (const e of evidence) {
      const url = await ctx.storage.getUrl(e.storageId);
      results.push({ id: e._id, type: e.type, url, capturedAt: e.capturedAt });
    }
    return results;
  },
});

/** Pemilik bisa hapus bukti miliknya sendiri kapan saja (kontrol penuh atas rekamannya). */
export const deleteAlarmEvidence = mutation({
  args: { evidenceId: v.id("alarmEvidence") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) return;
    if (evidence.userId !== userId) {
      throw new ConvexError({ message: "Anda tidak memiliki izin untuk menghapus ini.", code: "FORBIDDEN" });
    }
    await ctx.storage.delete(evidence.storageId);
    await ctx.db.delete(args.evidenceId);
  },
});
