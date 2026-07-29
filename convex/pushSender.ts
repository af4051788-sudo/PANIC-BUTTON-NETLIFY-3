"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel.js";
import webpush from "web-push";

function getVapidDetails(): { publicKey: string; privateKey: string; subject: string } {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum di-set di Convex dashboard (Settings > Environment Variables).",
    );
  }
  return { publicKey, privateKey, subject };
}

/**
 * Send a push notification to every subscribed device belonging to the given
 * users. Called via ctx.scheduler.runAfter(0, ...) from mutations, since
 * mutations can't perform network calls themselves.
 */
export const sendAlarmPush = internalAction({
  args: {
    userIds: v.array(v.id("users")),
    title: v.string(),
    body: v.string(),
    alarmId: v.optional(v.string()),
    urgent: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ sent: number; total?: number }> => {
    if (args.userIds.length === 0) return { sent: 0 };

    const { publicKey, privateKey, subject } = getVapidDetails();
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const subscriptions: Doc<"pushSubscriptions">[] = await ctx.runQuery(
      internal.push.getSubscriptionsForUsers,
      { userIds: args.userIds as Id<"users">[] },
    );

    const payload = JSON.stringify({
      title: args.title,
      body: args.body,
      alarmId: args.alarmId,
      urgent: args.urgent ?? true,
      timestamp: Date.now(),
    });

    let sent = 0;
    await Promise.all(
      subscriptions.map(async (sub: Doc<"pushSubscriptions">) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { urgency: "high", TTL: 60 },
          );
          sent += 1;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          // 404/410 = subscription is gone (uninstalled, expired) — clean it up.
          if (statusCode === 404 || statusCode === 410) {
            await ctx.runMutation(internal.push.deleteSubscriptionByEndpoint, {
              endpoint: sub.endpoint,
            });
          } else {
            console.error("Push send failed:", statusCode, err);
          }
        }
      }),
    );

    return { sent, total: subscriptions.length };
  },
});
