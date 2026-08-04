import { internalMutation, internalQuery } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { resolveAlarmRecipients } from "./push";

/**
 * Scheduled job: auto-eskalasi alarm escort yang sudah > 6 menit tanpa resolusi.
 * Dipanggil oleh startEscortMode di groups.ts setelah 6 menit.
 */
export const autoEscalateEscort = internalMutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const alarm = await ctx.db.get(args.alarmId);
    // Hanya eskalasi jika masih aktif dan belum di-escalate
    if (!alarm || alarm.status !== "active" || alarm.isEscalated) return;
    if (alarm.type !== "escort") return;

    await ctx.db.patch(args.alarmId, { isEscalated: true });

    const owner = await ctx.db.get(alarm.userId);

    // Kabari PEMANTAU ESCORT di dalam app (bukan cuma kontak darurat
    // eksternal) — ini yang sebelumnya HILANG: eskalasi tidak pernah benar-
    // benar terlihat oleh siapa pun di dalam aplikasi, cuma set flag internal
    // + coba SMS 1 kontak (yang diam-diam tidak berbuat apa-apa kalau nomor
    // kontak darurat belum diisi di profil).
    const recipients = await resolveAlarmRecipients(ctx, alarm.userId, alarm.alarmRecipients);
    if (recipients.length > 0) {
      await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
        userIds: recipients,
        title: "🚨 Escort Mode: Tidak Ada Konfirmasi!",
        body: `${owner?.name ?? "Anggota"} tidak konfirmasi aman tepat waktu. Segera cek kondisinya!`,
        alarmId: args.alarmId,
        urgent: true,
      });
    }

    // Escort tidak dikonfirmasi aman tepat waktu → treat sebagai darurat,
    // kabari juga kontak darurat eksternal (SMS/WA) kalau sudah diisi di profil.
    await ctx.scheduler.runAfter(0, internal.notifyContact.sendEmergencyContactAlert, {
      alarmId: args.alarmId,
    });
  },
});

/**
 * Scheduled job: tandai device offline jika tidak ada heartbeat > 5 menit.
 * Jalankan secara periodik via Convex cron (opsional — tambah di convex/crons.ts).
 */
export const markStaleDevicesOffline = internalMutation({
  args: {},
  handler: async (ctx) => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const devices = await ctx.db.query("devices").collect();

    for (const device of devices) {
      const shouldBeOffline =
        !device.lastHeartbeat || device.lastHeartbeat < fiveMinutesAgo;
      if (device.isOnline && shouldBeOffline) {
        await ctx.db.patch(device._id, { isOnline: false });
      }
    }
  },
});
