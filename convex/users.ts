import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Dipanggil setelah login — Convex Auth sudah otomatis membuat record users.
 * Fungsi ini hanya memastikan userId valid dan mengembalikannya.
 */
export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return userId;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    emergencyContact: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    locationPrivacy: v.optional(v.string()),
    evidenceCaptureEnabled: v.optional(v.boolean()),
    evidenceCaptureTypes: v.optional(
      v.array(v.union(v.literal("photo"), v.literal("audio"), v.literal("video"))),
    ),
    evidenceCaptureDurationSec: v.optional(v.number()),
    panicHoldDurationSec: v.optional(v.number()),
    escortDurationMinutes: v.optional(v.number()),
    panicRateLimiterEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });

    await ctx.db.patch(userId, {
      name: args.name ?? user.name,
      phone: args.phone,
      emergencyContact: args.emergencyContact,
      emergencyContactName: args.emergencyContactName,
      locationPrivacy: args.locationPrivacy,
      evidenceCaptureEnabled: args.evidenceCaptureEnabled ?? user.evidenceCaptureEnabled,
      evidenceCaptureTypes: args.evidenceCaptureTypes ?? user.evidenceCaptureTypes,
      evidenceCaptureDurationSec: args.evidenceCaptureDurationSec ?? user.evidenceCaptureDurationSec,
      panicHoldDurationSec: args.panicHoldDurationSec ?? user.panicHoldDurationSec,
      escortDurationMinutes: args.escortDurationMinutes ?? user.escortDurationMinutes,
      panicRateLimiterEnabled: args.panicRateLimiterEnabled ?? user.panicRateLimiterEnabled,
    });
  },
});
