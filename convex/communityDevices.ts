import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel.js";

function generateDeviceId(): string {
  return "WD1-C-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function generatePairingCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function assertGroupAdmin(
  ctx: { db: import("./_generated/server.js").QueryCtx["db"] },
  userId: Id<"users">,
  groupId: Id<"groups">,
) {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_and_user", (q) => q.eq("groupId", groupId).eq("userId", userId))
    .unique();
  if (!membership || membership.role !== "admin") {
    throw new ConvexError({ message: "Hanya admin grup yang bisa mengelola device komunal.", code: "FORBIDDEN" });
  }
}

/** Admin RT/RW mendaftarkan Wemos baru untuk lokasi bersama (Pos Satpam, dst). */
export const registerCommunityDevice = mutation({
  args: {
    groupId: v.id("groups"),
    locationLabel: v.string(), // "Pos Satpam Blok A"
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await assertGroupAdmin(ctx, userId, args.groupId);

    const id = await ctx.db.insert("devices", {
      userId, // admin yang mendaftarkan — hanya untuk keperluan pengelolaan
      deviceId: generateDeviceId(),
      name: args.locationLabel,
      pairingCode: generatePairingCode(),
      isOnline: false,
      deviceType: "community",
      locationLabel: args.locationLabel,
      groupId: args.groupId,
    });
    return { id };
  },
});

export const getGroupCommunityDevices = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Harus anggota grup untuk melihat daftar device komunalnya
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", userId))
      .unique();
    if (!membership) return [];

    return await ctx.db
      .query("devices")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
  },
});

/** Semua device komunal di seluruh grup yang diikuti user — dipakai di UI target selection. */
export const getMyGroupsCommunityDevices = query({
  args: {},
  handler: async (ctx): Promise<Array<{ id: string; locationLabel: string; groupName: string; isOnline: boolean }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const result: Array<{ id: string; locationLabel: string; groupName: string; isOnline: boolean }> = [];
    for (const m of memberships) {
      const group = await ctx.db.get(m.groupId);
      const devices = await ctx.db
        .query("devices")
        .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
        .collect();
      for (const d of devices) {
        result.push({
          id: d._id,
          locationLabel: d.locationLabel ?? d.name,
          groupName: group?.name ?? "",
          isOnline: d.isOnline,
        });
      }
    }
    return result;
  },
});

export const removeCommunityDevice = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const device = await ctx.db.get(args.deviceId);
    if (!device || !device.groupId) throw new ConvexError({ message: "Device tidak ditemukan.", code: "NOT_FOUND" });
    await assertGroupAdmin(ctx, userId, device.groupId);

    await ctx.db.delete(args.deviceId);
  },
});

export const regenerateCommunityPairingCode = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const device = await ctx.db.get(args.deviceId);
    if (!device || !device.groupId) throw new ConvexError({ message: "Device tidak ditemukan.", code: "NOT_FOUND" });
    await assertGroupAdmin(ctx, userId, device.groupId);

    await ctx.db.patch(args.deviceId, { pairingCode: generatePairingCode() });
  },
});
