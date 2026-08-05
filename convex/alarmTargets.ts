import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server.js";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel.js";

type TargetCategory = "panic_silent" | "escort";
type ReadCtx = { db: QueryCtx["db"] };

/**
 * Default target devices when the user/device hasn't customized their list:
 *  - user + panic_silent → their own personal devices + every community
 *    device (Pos Satpam/RT/RW/Fasum) across all groups they belong to.
 *  - user + escort → SAMA seperti panic_silent (device disiapkan sejak
 *    awal), TAPI device baru benar-benar dibunyikan setelah alarm
 *    di-eskalasi (timeout tanpa konfirmasi "Aman") — lihat isEscalated di
 *    convex/iot.ts:getAlarmStatus. Selama masih dalam masa pemantauan
 *    normal, device tetap senyap walau targetnya sudah tersimpan.
 *  - device (community) + escort → not applicable (community devices don't
 *    have an escort concept), returns [].
 */
async function computeDefaultTargets(
  ctx: ReadCtx,
  owner: { type: "user"; id: Id<"users"> } | { type: "device"; id: Id<"devices"> },
  category: TargetCategory,
): Promise<Id<"devices">[]> {
  if (category === "escort" && owner.type === "device") return [];

  if (owner.type === "user") {
    const personalDevices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", owner.id))
      .collect();
    const personalIds = personalDevices
      .filter((d) => (d.deviceType ?? "personal") === "personal")
      .map((d) => d._id);

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", owner.id))
      .collect();

    const communityIds: Id<"devices">[] = [];
    for (const m of memberships) {
      const communityDevices = await ctx.db
        .query("devices")
        .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
        .collect();
      communityDevices.forEach((d) => communityIds.push(d._id));
    }

    return Array.from(new Set([...personalIds, ...communityIds]));
  }

  // owner.type === "device" (a community device's physical button)
  const device = await ctx.db.get(owner.id);
  if (!device || !device.groupId) return [];

  const members = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", device.groupId!))
    .collect();

  const allIds: Id<"devices">[] = [];
  for (const m of members) {
    const userDevices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", m.userId))
      .collect();
    userDevices.forEach((d) => allIds.push(d._id));
  }
  const communityDevices = await ctx.db
    .query("devices")
    .withIndex("by_group", (q) => q.eq("groupId", device.groupId!))
    .collect();
  communityDevices.forEach((d) => allIds.push(d._id));

  return Array.from(new Set(allIds));
}

/**
 * Resolve the actual target device list for a trigger event — checks for a
 * saved override first, falls back to the sensible default above. This is
 * called at alarm-creation time (from alarms.ts / groups.ts / iot.ts) and
 * the result is stored directly on the alarm document, so devices polling
 * for status never need to re-derive any of this logic themselves.
 */
export async function resolveTargetDeviceIds(
  ctx: ReadCtx,
  owner: { type: "user"; id: Id<"users"> } | { type: "device"; id: Id<"devices"> },
  category: TargetCategory,
): Promise<Id<"devices">[]> {
  const override = await ctx.db
    .query("alarmTargetPreferences")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", owner.type).eq("ownerId", owner.id).eq("category", category),
    )
    .unique();
  if (override) return override.targetDeviceIds;
  return computeDefaultTargets(ctx, owner, category);
}

// ── User-facing queries/mutations for the "Kelola Target Alarm" page ───────

export const getMyAlarmTargets = query({
  args: { category: v.union(v.literal("panic_silent"), v.literal("escort")) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    selectedDeviceIds: string[];
    isCustomized: boolean;
    availableDevices: Array<{ id: string; name: string; deviceType: string; groupName?: string; isOnline: boolean }>;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { selectedDeviceIds: [], isCustomized: false, availableDevices: [] };

    const override = await ctx.db
      .query("alarmTargetPreferences")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", "user").eq("ownerId", userId).eq("category", args.category),
      )
      .unique();

    const selected = override
      ? override.targetDeviceIds
      : await computeDefaultTargets(ctx, { type: "user", id: userId }, args.category);

    // Build the catalog: user's own personal devices + community devices of their groups
    const personalDevices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const availableDevices: Array<{ id: string; name: string; deviceType: string; groupName?: string; isOnline: boolean }> = [];
    for (const d of personalDevices) {
      if ((d.deviceType ?? "personal") === "personal") {
        availableDevices.push({ id: d._id, name: d.name, deviceType: "personal", isOnline: d.isOnline });
      }
    }
    for (const m of memberships) {
      const group = await ctx.db.get(m.groupId);
      const communityDevices = await ctx.db
        .query("devices")
        .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
        .collect();
      for (const d of communityDevices) {
        availableDevices.push({
          id: d._id,
          name: d.locationLabel ?? d.name,
          deviceType: "community",
          groupName: group?.name,
          isOnline: d.isOnline,
        });
      }
    }

    return {
      selectedDeviceIds: selected,
      isCustomized: !!override,
      availableDevices,
    };
  },
});

export const setMyAlarmTargets = mutation({
  args: {
    category: v.union(v.literal("panic_silent"), v.literal("escort")),
    targetDeviceIds: v.array(v.id("devices")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const existing = await ctx.db
      .query("alarmTargetPreferences")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", "user").eq("ownerId", userId).eq("category", args.category),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { targetDeviceIds: args.targetDeviceIds });
    } else {
      await ctx.db.insert("alarmTargetPreferences", {
        ownerType: "user",
        ownerId: userId,
        category: args.category,
        targetDeviceIds: args.targetDeviceIds,
      });
    }
  },
});

export const resetMyAlarmTargetsToDefault = mutation({
  args: { category: v.union(v.literal("panic_silent"), v.literal("escort")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const existing = await ctx.db
      .query("alarmTargetPreferences")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", "user").eq("ownerId", userId).eq("category", args.category),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// ── Admin-facing: target list for a community device's own physical button ─

export const getCommunityDeviceTargets = query({
  args: { deviceId: v.id("devices") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    selectedDeviceIds: string[];
    isCustomized: boolean;
    availableDevices: Array<{ id: string; name: string; deviceType: string; isOnline: boolean }>;
  } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const device = await ctx.db.get(args.deviceId);
    if (!device || !device.groupId) return null;

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", device.groupId!).eq("userId", userId))
      .unique();
    if (!membership || membership.role !== "admin") return null;

    const override = await ctx.db
      .query("alarmTargetPreferences")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", "device").eq("ownerId", args.deviceId).eq("category", "panic_silent"),
      )
      .unique();

    const selected = override
      ? override.targetDeviceIds
      : await computeDefaultTargets(ctx, { type: "device", id: args.deviceId }, "panic_silent");

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", device.groupId!))
      .collect();
    const availableDevices: Array<{ id: string; name: string; deviceType: string; isOnline: boolean }> = [];
    for (const m of members) {
      const userDevices = await ctx.db
        .query("devices")
        .withIndex("by_user", (q) => q.eq("userId", m.userId))
        .collect();
      userDevices.forEach((d) =>
        availableDevices.push({ id: d._id, name: d.name, deviceType: "personal", isOnline: d.isOnline }),
      );
    }
    const communityDevices = await ctx.db
      .query("devices")
      .withIndex("by_group", (q) => q.eq("groupId", device.groupId!))
      .collect();
    communityDevices.forEach((d) =>
      availableDevices.push({
        id: d._id,
        name: d.locationLabel ?? d.name,
        deviceType: "community",
        isOnline: d.isOnline,
      }),
    );

    return { selectedDeviceIds: selected, isCustomized: !!override, availableDevices };
  },
});

export const setCommunityDeviceTargets = mutation({
  args: { deviceId: v.id("devices"), targetDeviceIds: v.array(v.id("devices")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const device = await ctx.db.get(args.deviceId);
    if (!device || !device.groupId) throw new ConvexError({ message: "Device tidak ditemukan.", code: "NOT_FOUND" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", device.groupId!).eq("userId", userId))
      .unique();
    if (!membership || membership.role !== "admin") {
      throw new ConvexError({ message: "Hanya admin grup yang bisa mengatur ini.", code: "FORBIDDEN" });
    }

    const existing = await ctx.db
      .query("alarmTargetPreferences")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", "device").eq("ownerId", args.deviceId).eq("category", "panic_silent"),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { targetDeviceIds: args.targetDeviceIds });
    } else {
      await ctx.db.insert("alarmTargetPreferences", {
        ownerType: "device",
        ownerId: args.deviceId,
        category: "panic_silent",
        targetDeviceIds: args.targetDeviceIds,
      });
    }
  },
});
