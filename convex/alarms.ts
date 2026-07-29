import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { resolveAlarmRecipients } from "./push";
import { rateLimiter } from "./rateLimiting";
import { resolveTargetDeviceIds } from "./alarmTargets";

const ALARM_TITLES: Record<string, string> = {
  panic: "🚨 Alarm Darurat",
  silent: "🔕 Alarm Senyap",
  escort: "🚶 Mode Kawal",
};

export const triggerAlarm = mutation({
  args: {
    type: v.union(v.literal("panic"), v.literal("silent"), v.literal("escort")),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    await rateLimiter.limit(ctx, "createAlarm", { key: userId, throws: true });

    // Resolve any existing active alarms first
    const existingActive = await ctx.db
      .query("alarms")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    for (const alarm of existingActive) {
      await ctx.db.patch(alarm._id, { status: "resolved", resolvedAt: new Date().toISOString() });
    }

    const targetDeviceIds = await resolveTargetDeviceIds(
      ctx,
      { type: "user", id: userId },
      args.type === "escort" ? "escort" : "panic_silent",
    );

    const id = await ctx.db.insert("alarms", {
      userId,
      deviceId: args.deviceId,
      type: args.type,
      status: "active",
      latitude: args.latitude,
      longitude: args.longitude,
      startedAt: new Date().toISOString(),
      isEscalated: false,
      targetDeviceIds,
    });

    // Fan out a push notification to group members (best-effort, never blocks
    // the alarm from being recorded even if push fails or isn't configured).
    const recipients = await resolveAlarmRecipients(ctx, userId);
    if (recipients.length > 0) {
      const sender = await ctx.db.get(userId);
      await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
        userIds: recipients,
        title: ALARM_TITLES[args.type] ?? "🚨 Alarm Darurat",
        body: `${sender?.name ?? "Anggota grup"} membutuhkan bantuan segera.`,
        alarmId: id,
        urgent: args.type !== "silent",
      });
    }

    // Fallback WhatsApp to emergency contact if not resolved within 15s
    // (matches the promise shown on the Profile page).
    if (args.type !== "escort") {
      await ctx.scheduler.runAfter(15 * 1000, internal.notifyContact.sendEmergencyContactAlert, {
        alarmId: id,
      });
    }

    return id;
  },
});

export const resolveAlarm = mutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) throw new ConvexError({ message: "Alarm not found", code: "NOT_FOUND" });

    const isOwner = alarm.userId === userId;
    let isGroupAdmin = false;
    if (!isOwner && alarm.groupId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_and_user", (q) => q.eq("groupId", alarm.groupId!).eq("userId", userId))
        .unique();
      isGroupAdmin = membership?.role === "admin";
    }
    if (!isOwner && !isGroupAdmin) {
      throw new ConvexError({ message: "Anda tidak memiliki izin untuk mematikan alarm ini.", code: "FORBIDDEN" });
    }

    await ctx.db.patch(args.alarmId, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
  },
});

export const getMyActiveAlarm = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const alarm = await ctx.db
      .query("alarms")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (!alarm) return null;

    const responses = await ctx.db
      .query("alarmResponses")
      .withIndex("by_alarm", (q) => q.eq("alarmId", alarm._id))
      .collect();

    return { ...alarm, responderCount: responses.length };
  },
});

export const getRecentAlarms = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("alarms")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 30);
  },
});

export const submitIncidentReport = mutation({
  args: {
    alarmId: v.id("alarms"),
    category: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    await ctx.db.patch(args.alarmId, {
      incidentCategory: args.category,
      reportDescription: args.description,
    });
  },
});

/**
 * Tandai alarm sebagai alarm palsu (false alarm).
 * Hanya bisa dilakukan oleh pemilik alarm sendiri.
 */
export const markFalseAlarm = mutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) throw new ConvexError({ message: "Alarm not found", code: "NOT_FOUND" });
    if (alarm.userId !== userId)
      throw new ConvexError({ message: "Bukan alarm Anda.", code: "FORBIDDEN" });

    await ctx.db.patch(args.alarmId, {
      status: "false_alarm",
      resolvedAt: new Date().toISOString(),
    });
  },
});
