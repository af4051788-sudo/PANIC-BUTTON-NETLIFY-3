import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { resolveAlarmRecipients, resolveGroupWideRecipients } from "./push";
import { rateLimiter } from "./rateLimiting";
import { resolveTargetDeviceIds } from "./alarmTargets";

export const heartbeat = internalMutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
    wifiStrength: v.optional(v.number()),
    batteryLevel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rl = await rateLimiter.limit(ctx, "deviceHeartbeat", { key: args.deviceId });
    if (!rl.ok) return { ok: false, rateLimited: true, retryAfter: rl.retryAfter };

    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode) return { ok: false };

    await ctx.db.patch(device._id, {
      isOnline: true,
      lastHeartbeat: new Date().toISOString(),
      wifiStrength: args.wifiStrength,
      batteryLevel: args.batteryLevel,
    });
    return { ok: true };
  },
});

// ── Personal device: physical button triggers/deactivates the OWNER's own alarm ─

export const activateAlarm = internalMutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
    type: v.union(v.literal("panic"), v.literal("silent")),
  },
  handler: async (ctx, args) => {
    const rl = await rateLimiter.limit(ctx, "deviceAlarmToggle", { key: args.deviceId });
    if (!rl.ok) return { ok: false, rateLimited: true, retryAfter: rl.retryAfter };

    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode) return { ok: false };
    if (device.deviceType === "community") return { ok: false }; // pakai activateCommunityAlarm

    // Resolve existing active alarms for this device user
    const existingActive = await ctx.db
      .query("alarms")
      .withIndex("by_user", (q) => q.eq("userId", device.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    for (const alarm of existingActive) {
      await ctx.db.patch(alarm._id, { status: "resolved", resolvedAt: new Date().toISOString() });
    }

    const targetDeviceIds = await resolveTargetDeviceIds(
      ctx,
      { type: "user", id: device.userId },
      "panic_silent",
    );

    const alarmId = await ctx.db.insert("alarms", {
      userId: device.userId,
      deviceId: args.deviceId,
      type: args.type,
      status: "active",
      startedAt: new Date().toISOString(),
      isEscalated: true, // panic/silent dari tombol fisik langsung aktif/bunyi
      targetDeviceIds,
    });

    const recipients = await resolveAlarmRecipients(ctx, device.userId);
    if (recipients.length > 0) {
      const owner = await ctx.db.get(device.userId);
      await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
        userIds: recipients,
        title: args.type === "silent" ? "🔕 Alarm Senyap" : "🚨 Alarm Darurat",
        body: `${owner?.name ?? "Anggota grup"} menekan tombol darurat (perangkat ${device.name}).`,
        alarmId,
        urgent: args.type !== "silent",
      });
    }

    await ctx.scheduler.runAfter(15 * 1000, internal.notifyContact.sendEmergencyContactAlert, {
      alarmId,
    });

    return { ok: true, alarmId };
  },
});

export const deactivateAlarm = internalMutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
  },
  handler: async (ctx, args) => {
    const rl = await rateLimiter.limit(ctx, "deviceAlarmToggle", { key: args.deviceId });
    if (!rl.ok) return { ok: false, rateLimited: true, retryAfter: rl.retryAfter };

    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode) return { ok: false };

    const activeAlarms = await ctx.db
      .query("alarms")
      .withIndex("by_user", (q) => q.eq("userId", device.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    for (const alarm of activeAlarms) {
      if (alarm.deviceId === args.deviceId) {
        await ctx.db.patch(alarm._id, {
          status: "resolved",
          resolvedAt: new Date().toISOString(),
        });
      }
    }
    return { ok: true };
  },
});

export const escalateAlarm = internalMutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
  },
  handler: async (ctx, args) => {
    const rl = await rateLimiter.limit(ctx, "deviceAlarmToggle", { key: args.deviceId });
    if (!rl.ok) return { ok: false, rateLimited: true, retryAfter: rl.retryAfter };

    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode) return { ok: false };

    const activeAlarm = await ctx.db
      .query("alarms")
      .withIndex("by_user", (q) => q.eq("userId", device.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (activeAlarm) {
      await ctx.db.patch(activeAlarm._id, { isEscalated: true, everEscalated: true });
    }
    return { ok: true };
  },
});

// ── Community device: physical button triggers/deactivates a LOCATION alarm ─
// (Pos Satpam, Kantor RT/RW, Fasum, dst — bukan atas nama satu orang.)

export const activateCommunityAlarm = internalMutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
    type: v.union(v.literal("panic"), v.literal("silent")),
  },
  handler: async (ctx, args) => {
    const rl = await rateLimiter.limit(ctx, "deviceAlarmToggle", { key: args.deviceId });
    if (!rl.ok) return { ok: false, rateLimited: true, retryAfter: rl.retryAfter };

    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode) return { ok: false };
    if (device.deviceType !== "community" || !device.groupId) return { ok: false };

    // Resolve any existing active alarm this same device already triggered
    const existingActive = await ctx.db
      .query("alarms")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .filter((q) => q.eq(q.field("deviceId"), args.deviceId))
      .collect();
    for (const alarm of existingActive) {
      await ctx.db.patch(alarm._id, { status: "resolved", resolvedAt: new Date().toISOString() });
    }

    const targetDeviceIds = await resolveTargetDeviceIds(
      ctx,
      { type: "device", id: device._id },
      "panic_silent",
    );

    const locationLabel = device.locationLabel ?? device.name;

    const alarmId = await ctx.db.insert("alarms", {
      userId: device.userId, // admin yang mendaftarkan — bukan "pemicu", hanya field teknis wajib
      deviceId: args.deviceId,
      type: args.type,
      status: "active",
      startedAt: new Date().toISOString(),
      isEscalated: true, // panic/silent dari tombol fisik komunal langsung aktif/bunyi
      groupId: device.groupId,
      targetDeviceIds,
      isLocationTriggered: true,
      triggerLocationLabel: locationLabel,
    });

    const recipients = await resolveGroupWideRecipients(ctx, device.groupId);
    if (recipients.length > 0) {
      await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
        userIds: recipients,
        title: args.type === "silent" ? "🔕 Alarm Senyap Lokasi" : "🚨 Alarm Darurat Lokasi",
        body: `${locationLabel} memicu alarm darurat. Ada kejadian di lokasi ini.`,
        alarmId,
        urgent: args.type !== "silent",
      });
    }

    return { ok: true, alarmId };
  },
});

export const deactivateCommunityAlarm = internalMutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
  },
  handler: async (ctx, args) => {
    const rl = await rateLimiter.limit(ctx, "deviceAlarmToggle", { key: args.deviceId });
    if (!rl.ok) return { ok: false, rateLimited: true, retryAfter: rl.retryAfter };

    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode) return { ok: false };
    if (device.deviceType !== "community") return { ok: false };

    const activeAlarms = await ctx.db
      .query("alarms")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .filter((q) => q.eq(q.field("deviceId"), args.deviceId))
      .collect();

    for (const alarm of activeAlarms) {
      await ctx.db.patch(alarm._id, { status: "resolved", resolvedAt: new Date().toISOString() });
    }
    return { ok: true };
  },
});

const SENSOR_ALERT_TEXT: Record<"door" | "fire" | "flood", { title: string; verb: string }> = {
  door: { title: "🚪 Sensor Pintu Terbuka", verb: "pintu terbuka" },
  fire: { title: "🔥 TERDETEKSI API!", verb: "kemungkinan kebakaran" },
  flood: { title: "💧 Terdeteksi Air/Banjir", verb: "genangan air/banjir" },
};

/**
 * Dipanggil firmware Wemos setiap ada PERUBAHAN status sensor pintu/api/air
 * (bukan tiap loop — cuma saat transisi idle↔trigger, lihat checkSensors()
 * di firmware). Sensor yang tidak diaktifkan lewat app (sensorsEnabled) akan
 * diabaikan, sebagai jaring pengaman kalau pin sensor tidak sengaja terbaca
 * berubah padahal user tidak memasang sensor itu.
 */
export const reportSensorEvent = internalMutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
    sensorKind: v.union(v.literal("door"), v.literal("fire"), v.literal("flood")),
    triggered: v.boolean(),
  },
  handler: async (ctx, args) => {
    const rl = await rateLimiter.limit(ctx, "deviceAlarmToggle", { key: args.deviceId });
    if (!rl.ok) return { ok: false, rateLimited: true, retryAfter: rl.retryAfter };

    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode) return { ok: false };
    if (!device.sensorsEnabled?.includes(args.sensorKind)) return { ok: false }; // sensor ini tidak diaktifkan di app

    const wasTriggered = device.lastSensorState?.[args.sensorKind] ?? false;
    await ctx.db.patch(device._id, {
      lastSensorState: { ...device.lastSensorState, [args.sensorKind]: args.triggered },
    });

    if (args.triggered === wasTriggered) return { ok: true }; // tidak ada perubahan, tidak perlu apa-apa

    if (!args.triggered) {
      // Sensor kembali normal (pintu ditutup, dst) — selesaikan alarm sensor
      // yang masih aktif dari device+jenis sensor ini kalau ada.
      const stillActive = await ctx.db
        .query("alarms")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .filter((q) => q.and(q.eq(q.field("deviceId"), args.deviceId), q.eq(q.field("sensorKind"), args.sensorKind)))
        .collect();
      for (const alarm of stillActive) {
        await ctx.db.patch(alarm._id, { status: "resolved", resolvedAt: new Date().toISOString() });
      }
      return { ok: true };
    }

    // Baru trigger — buat alarm baru.
    const isCommunity = device.deviceType === "community" && !!device.groupId;
    const targetDeviceIds = await resolveTargetDeviceIds(
      ctx,
      isCommunity ? { type: "device", id: device._id } : { type: "user", id: device.userId },
      "panic_silent",
    );
    const locationLabel = device.locationLabel ?? device.name;
    const { title, verb } = SENSOR_ALERT_TEXT[args.sensorKind];

    const alarmId = await ctx.db.insert("alarms", {
      userId: device.userId,
      deviceId: args.deviceId,
      type: "sensor",
      sensorKind: args.sensorKind,
      status: "active",
      startedAt: new Date().toISOString(),
      isEscalated: true, // sensor apapun (pintu/api/air) langsung aktif/bunyi begitu terdeteksi
      everEscalated: args.sensorKind === "fire", // cuma api yang dihitung "eskalasi sungguhan" utk statistik admin
      groupId: isCommunity ? device.groupId : undefined,
      targetDeviceIds,
      isLocationTriggered: isCommunity,
      triggerLocationLabel: isCommunity ? locationLabel : undefined,
    });

    const recipients = isCommunity
      ? await resolveGroupWideRecipients(ctx, device.groupId!)
      : await resolveAlarmRecipients(ctx, device.userId);
    if (recipients.length > 0) {
      await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
        userIds: recipients,
        title,
        body: `Terdeteksi ${verb} di ${locationLabel}.`,
        alarmId,
        urgent: args.sensorKind === "fire",
      });
    }

    return { ok: true, alarmId };
  },
});

// ── Unified polling: ANY device (personal or community) checks whether it
// is currently a TARGET of any active alarm, regardless of who/what
// triggered it. This is what makes the local/global targeting system work —
// a device only rings if it's in some active alarm's targetDeviceIds.

export const getAlarmStatus = internalQuery({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
  },
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!device || device.pairingCode !== args.pairingCode)
      return { ok: false, alarmActive: false };

    const activeAlarms = await ctx.db
      .query("alarms")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Prefer an alarm this device itself triggered (so it always hears its
    // own button press even if somehow excluded from its own target list),
    // otherwise any alarm that explicitly targets this device. `isEscalated`
    // di sini dipakai generik sebagai penanda "target sedang bunyi/aktif"
    // untuk SEMUA tipe alarm (bukan cuma escort) — panic/silent/sensor mulai
    // dengan isEscalated: true (langsung bunyi), escort mulai false (senyap,
    // baru true setelah timeout tanpa konfirmasi "Aman"). Begitu ada anggota
    // yang merespon (respondToAlarm di groups.ts), isEscalated di-set false
    // lagi supaya device fisik ikut berhenti bunyi juga.
    const ownTrigger = activeAlarms.find((a) => a.deviceId === args.deviceId && a.isEscalated);
    const targeting =
      ownTrigger ??
      activeAlarms.find((a) => a.targetDeviceIds?.includes(device._id) && a.isEscalated);

    // Alarm "sensor" dan "escort" bukan wire-type asli yang dikenal firmware
    // — petakan ke "panic" (siren penuh) atau "silent" (notifikasi saja).
    // Escort yang lolos filter di atas SUDAH PASTI ter-eskalasi (darurat
    // sungguhan), jadi selalu dipetakan siren penuh.
    let wireAlarmType: string | undefined = targeting?.type;
    if (targeting?.type === "sensor") {
      wireAlarmType = targeting.sensorKind === "fire" ? "panic" : "silent";
    } else if (targeting?.type === "escort") {
      wireAlarmType = "panic";
    }

    return {
      ok: true,
      alarmActive: !!targeting,
      alarmType: wireAlarmType,
      isEscalated: targeting?.isEscalated ?? false,
      label: targeting?.triggerLocationLabel,
    };
  },
});
