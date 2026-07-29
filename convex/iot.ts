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
      isEscalated: false,
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
      await ctx.db.patch(activeAlarm._id, { isEscalated: true });
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
      isEscalated: false,
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
    // otherwise any alarm that explicitly targets this device.
    const ownTrigger = activeAlarms.find((a) => a.deviceId === args.deviceId);
    const targeting =
      ownTrigger ??
      activeAlarms.find((a) => a.targetDeviceIds?.includes(device._id));

    return {
      ok: true,
      alarmActive: !!targeting,
      alarmType: targeting?.type,
      isEscalated: targeting?.isEscalated ?? false,
      label: targeting?.triggerLocationLabel,
    };
  },
});
