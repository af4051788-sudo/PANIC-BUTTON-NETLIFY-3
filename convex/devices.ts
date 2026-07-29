import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

function generateDeviceId(): string {
  return "WD1-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function generatePairingCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export const createDevice = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const id = await ctx.db.insert("devices", {
      userId,
      deviceId: generateDeviceId(),
      name: args.name,
      pairingCode: generatePairingCode(),
      isOnline: false,
      deviceType: "personal",
    });
    return { id };
  },
});

export const getMyDevices = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Device komunal (Pos Satpam, dst) dikelola lewat halaman grup, bukan
    // tercampur di daftar "device pribadi saya" meski admin yang mendaftarkannya.
    return devices.filter((d) => (d.deviceType ?? "personal") === "personal");
  },
});

export const deleteDevice = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const device = await ctx.db.get(args.deviceId);
    if (!device) return;
    if (device.userId !== userId) {
      throw new ConvexError({ message: "Anda tidak memiliki izin untuk menghapus device ini.", code: "FORBIDDEN" });
    }
    await ctx.db.delete(args.deviceId);
  },
});

export const deviceHeartbeat = mutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
    wifiStrength: v.optional(v.number()),
    batteryLevel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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

export const regeneratePairingCode = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const device = await ctx.db.get(args.deviceId);
    if (!device) return;
    if (device.userId !== userId) {
      throw new ConvexError({ message: "Anda tidak memiliki izin untuk device ini.", code: "FORBIDDEN" });
    }
    await ctx.db.patch(args.deviceId, { pairingCode: generatePairingCode() });
  },
});
