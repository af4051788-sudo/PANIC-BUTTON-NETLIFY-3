import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel.js";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";

// ── Helper: pastikan user sudah login dan memiliki role admin ────────────────
// Untuk mutations: throw error (transaksi dibatalkan)
async function requireAdmin(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user || user.role !== "admin") {
    throw new ConvexError({ message: "Akses ditolak. Hanya admin.", code: "FORBIDDEN" });
  }
  return user;
}

// Untuk queries: return null (UI handle tampilan "bukan admin")
async function checkAdmin(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user || user.role !== "admin") return null;
  return user;
}

export const getAllActiveAlarms = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const isAdmin = await checkAdmin(ctx, userId);
    if (!isAdmin) return [];

    const alarms = await ctx.db
      .query("alarms")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .collect();

    return Promise.all(
      alarms.map(async (a) => {
        const user = await ctx.db.get(a.userId);
        return {
          ...a,
          userName: a.isLocationTriggered ? (a.triggerLocationLabel ?? "Lokasi") : (user?.name ?? "Unknown"),
          userEmail: user?.email,
        };
      }),
    );
  },
});

export const getAllAlarmsPaginated = query({
  args: {
    status: v.optional(v.union(v.literal("active"), v.literal("resolved"), v.literal("false_alarm"))),
    type: v.optional(v.union(v.literal("panic"), v.literal("silent"), v.literal("escort"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const isAdmin = await checkAdmin(ctx, userId);
    if (!isAdmin) return [];

    const alarms = await ctx.db.query("alarms").order("desc").take(100);
    const filtered = alarms.filter((a) => {
      if (args.status && a.status !== args.status) return false;
      if (args.type && a.type !== args.type) return false;
      return true;
    });

    return Promise.all(
      filtered.map(async (a) => {
        const user = await ctx.db.get(a.userId);
        return {
          ...a,
          userName: a.isLocationTriggered ? (a.triggerLocationLabel ?? "Lokasi") : (user?.name ?? "Unknown"),
          userEmail: user?.email,
        };
      }),
    );
  },
});

export const getDashboardStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const isAdmin = await checkAdmin(ctx, userId);
    if (!isAdmin) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const allAlarms = await ctx.db.query("alarms").order("desc").take(500);
    const todayAlarms = allAlarms.filter((a) => a.startedAt >= todayISO);
    const activeAlarms = allAlarms.filter((a) => a.status === "active");
    const escalatedAlarms = allAlarms.filter((a) => a.isEscalated);

    const resolvedWithTime = allAlarms.filter(
      (a) => a.status === "resolved" && a.resolvedAt,
    );
    const avgMs =
      resolvedWithTime.length > 0
        ? resolvedWithTime.reduce((acc, a) => {
            const start = new Date(a.startedAt).getTime();
            const end = new Date(a.resolvedAt!).getTime();
            return acc + (end - start);
          }, 0) / resolvedWithTime.length
        : 0;

    const allDevices = await ctx.db.query("devices").collect();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const onlineDevices = allDevices.filter(
      (d) => d.lastHeartbeat && d.lastHeartbeat > fiveMinutesAgo,
    ).length;

    return {
      todayCount: todayAlarms.length,
      activeCount: activeAlarms.length,
      escalatedCount: escalatedAlarms.length,
      avgResponseMinutes: Math.round(avgMs / 60000),
      totalDevices: allDevices.length,
      onlineDevices,
    };
  },
});

export const getAllDevicesAdmin = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const isAdmin = await checkAdmin(ctx, userId);
    if (!isAdmin) return [];

    const devices = await ctx.db.query("devices").collect();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    return Promise.all(
      devices.map(async (d) => {
        const owner = await ctx.db.get(d.userId);
        const isOnline = !!(d.lastHeartbeat && d.lastHeartbeat > fiveMinutesAgo);
        return {
          ...d,
          isOnline,
          ownerName: owner?.name ?? "Unknown",
        };
      }),
    );
  },
});

export const sendBroadcast = mutation({
  args: {
    message: v.string(),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    const user = await requireAdmin(ctx, userId);

    await ctx.db.insert("broadcasts", {
      senderId: userId,
      senderName: user.name ?? "Admin",
      message: args.message,
      groupId: args.groupId,
      sentAt: new Date().toISOString(),
    });
  },
});

export const sendResponderNote = mutation({
  args: {
    alarmId: v.id("alarms"),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requireAdmin(ctx, userId);

    await ctx.db.patch(args.alarmId, {
      responderNote: args.note,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
  },
});

export const forceResolveAlarm = mutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requireAdmin(ctx, userId);

    await ctx.db.patch(args.alarmId, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
  },
});

/**
 * Promosikan user menjadi admin.
 * Hanya bisa dilakukan oleh admin yang sudah ada.
 * Untuk setup pertama kali, gunakan mutation setFirstAdmin di bawah.
 */
export const promoteToAdmin = mutation({
  args: { targetUserId: v.id("users") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requireAdmin(ctx, userId);
    await ctx.db.patch(args.targetUserId, { role: "admin" });
  },
});

/**
 * Setup pertama kali: jadikan diri sendiri admin.
 * Hanya bisa dijalankan jika BELUM ADA admin sama sekali di database.
 */
export const setFirstAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    // Cek apakah sudah ada admin
    const existing = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .first();

    if (existing) {
      throw new ConvexError({
        message: "Admin sudah ada. Hubungi admin untuk promosi akun.",
        code: "CONFLICT",
      });
    }

    await ctx.db.patch(userId, { role: "admin" });
    return { success: true };
  },
});
