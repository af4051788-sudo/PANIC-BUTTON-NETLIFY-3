import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
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

/**
 * Cari user berdasarkan nama/email — dipakai halaman "Kelola Admin" untuk
 * cari calon admin baru. Cuma admin yang boleh pakai (biar tidak jadi celah
 * enumerasi data user oleh sembarang orang). Minimal 2 karakter supaya tidak
 * sengaja return semua user sekaligus saat search box masih kosong.
 */
export const searchUsers = query({
  args: { search: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const isAdmin = await checkAdmin(ctx, userId);
    if (!isAdmin) return [];

    const term = args.search.trim().toLowerCase();
    if (term.length < 2) return [];

    const allUsers = await ctx.db.query("users").collect();
    return allUsers
      .filter((u) => u.name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term))
      .slice(0, 20)
      .map((u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role ?? "user" }));
  },
});

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
    // Pakai everEscalated (historis, tidak pernah balik false), BUKAN
    // isEscalated (runtime, naik-turun tiap alarm bunyi/senyap) — supaya
    // statistik ini tetap berarti "pernah benar-benar eskalasi", bukan
    // ikut kehitung tiap panic/silent yang memang defaultnya langsung bunyi.
    const escalatedAlarms = allAlarms.filter((a) => a.everEscalated);

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

    const alarm = await ctx.db.get(args.alarmId);

    await ctx.db.patch(args.alarmId, {
      responderNote: args.note,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });

    if (alarm?.targetDeviceIds && alarm.targetDeviceIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.tuya.controlSmartPlugsForAlarm, {
        targetDeviceIds: alarm.targetDeviceIds,
        turnOn: false,
      });
    }
  },
});

export const forceResolveAlarm = mutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requireAdmin(ctx, userId);

    const alarm = await ctx.db.get(args.alarmId);

    await ctx.db.patch(args.alarmId, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });

    if (alarm?.targetDeviceIds && alarm.targetDeviceIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.tuya.controlSmartPlugsForAlarm, {
        targetDeviceIds: alarm.targetDeviceIds,
        turnOn: false,
      });
    }
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
 * Cabut status admin platform dari seseorang. Siapa pun yang SUDAH admin
 * platform berhak mencabut admin lain (termasuk mencabut dirinya sendiri) —
 * otoritasnya setara antar sesama admin platform, tidak ada "super-admin"
 * tunggal yang lebih berkuasa dari admin lainnya.
 *
 * Pengaman WAJIB: tidak boleh mencabut admin TERAKHIR yang tersisa — kalau
 * dibolehkan, aplikasi akan terkunci total (tidak ada satu pun yang bisa
 * masuk /admin lagi, bahkan untuk mempromosikan admin baru), karena
 * setFirstAdmin cuma jalan kalau BENAR-BENAR belum ada admin sama sekali.
 */
export const demoteAdmin = mutation({
  args: { targetUserId: v.id("users") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requireAdmin(ctx, userId);

    const allUsers = await ctx.db.query("users").collect();
    const adminCount = allUsers.filter((u) => u.role === "admin").length;
    if (adminCount <= 1) {
      throw new ConvexError({
        message: "Tidak bisa mencabut — ini admin platform TERAKHIR. Jadikan orang lain admin dulu sebelum mencabut yang ini.",
        code: "LAST_ADMIN",
      });
    }

    await ctx.db.patch(args.targetUserId, { role: "user" });
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
