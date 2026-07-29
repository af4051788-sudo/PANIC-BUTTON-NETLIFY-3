import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server.js";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel.js";

/**
 * Save (or refresh) the current browser's push subscription for this user.
 * A user can have multiple subscriptions (e.g. phone + laptop) — each
 * endpoint is unique, so we upsert on (userId, endpoint).
 */
export const saveSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
      });
      return { ok: true };
    }

    await ctx.db.insert("pushSubscriptions", {
      userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent,
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  },
});

export const removeSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Whether the current user has at least one active push subscription —
 * used to render the toggle state in Settings without exposing raw keys.
 */
export const getMyPushStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { subscribed: false, count: 0 };

    const subs = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return { subscribed: subs.length > 0, count: subs.length };
  },
});

// ── Internal helpers used by the Node action in pushSender.ts ───────────────

export const getSubscriptionsForUsers = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const results = [];
    for (const userId of args.userIds) {
      const subs = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      results.push(...subs);
    }
    return results;
  },
});

export const deleteSubscriptionByEndpoint = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/**
 * Resolve which users should be notified about `senderId`'s alarm across all
 * of their shared groups, honoring per-group `alarmRecipients` overrides.
 * Exported so alarms.ts / iot.ts / groups.ts can call it before scheduling
 * the push-send action (this must run inside the mutation, since it needs
 * db access that the Node action doesn't have).
 */
export async function resolveAlarmRecipients(
  ctx: MutationCtx,
  senderId: Id<"users">,
  explicitRecipients?: Id<"users">[],
): Promise<Id<"users">[]> {
  if (explicitRecipients && explicitRecipients.length > 0) return explicitRecipients;

  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", senderId))
    .collect();

  const recipients = new Set<Id<"users">>();
  for (const membership of memberships) {
    const groupMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", membership.groupId))
      .collect();
    const effective = membership.alarmRecipients;
    for (const gm of groupMembers) {
      if (gm.userId === senderId) continue;
      if (effective && !effective.includes(gm.userId)) continue;
      recipients.add(gm.userId);
    }
  }
  return Array.from(recipients);
}

/**
 * For alarms triggered by a community device's physical button (no single
 * "sender" user — the trigger is a location). Notifies every member of that
 * group, since there's no personal alarmRecipients preference to defer to.
 */
export async function resolveGroupWideRecipients(
  ctx: MutationCtx,
  groupId: Id<"groups">,
): Promise<Id<"users">[]> {
  const groupMembers = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  return groupMembers.map((gm) => gm.userId);
}
