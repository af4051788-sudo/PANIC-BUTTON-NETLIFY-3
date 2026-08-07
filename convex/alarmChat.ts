import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { rateLimiter } from "./rateLimiting";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Siapa yang boleh baca/kirim chat di 1 alarm — SAMA seperti siapa yang
 * boleh "respond" ke alarm itu (anggota grup yang sama dengan pemilik alarm,
 * menghormati alarmRecipients kalau di-custom), TAPI beda dari
 * canRespondToAlarm: pemilik alarm sendiri JUGA boleh (wajar, dia yang
 * paling butuh baca chat dari orang yang membantu).
 */
async function canAccessAlarmChat(
  ctx: { db: QueryCtx["db"] },
  alarm: { userId: Id<"users">; alarmRecipients?: Id<"users">[] },
  userId: Id<"users">,
): Promise<boolean> {
  if (alarm.userId === userId) return true;

  const ownerMemberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", alarm.userId))
    .collect();

  for (const ownerMembership of ownerMemberships) {
    const viewerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", ownerMembership.groupId).eq("userId", userId),
      )
      .unique();
    if (!viewerMembership) continue;

    const effective = alarm.alarmRecipients ?? ownerMembership.alarmRecipients;
    if (effective && !effective.includes(userId)) continue;

    return true;
  }
  return false;
}

export const getMessages = query({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) return [];
    if (!(await canAccessAlarmChat(ctx, alarm, userId))) return [];

    const messages = await ctx.db
      .query("alarmMessages")
      .withIndex("by_alarm", (q) => q.eq("alarmId", args.alarmId))
      .collect();

    return messages
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((m) => ({
        _id: m._id,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        createdAt: m.createdAt,
        isMe: m.senderId === userId,
      }));
  },
});

export const sendMessage = mutation({
  args: { alarmId: v.id("alarms"), text: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const text = args.text.trim().slice(0, 500); // batasi panjang — chat singkat, bukan esai
    if (!text) return;

    await rateLimiter.limit(ctx, "sendAlarmMessage", { key: userId, throws: true });

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) throw new ConvexError({ message: "Alarm tidak ditemukan.", code: "NOT_FOUND" });
    if (alarm.status !== "active") {
      throw new ConvexError({ message: "Alarm ini sudah tidak aktif.", code: "ALARM_INACTIVE" });
    }
    if (!(await canAccessAlarmChat(ctx, alarm, userId))) {
      throw new ConvexError({ message: "Anda tidak memiliki akses ke alarm ini.", code: "FORBIDDEN" });
    }

    const sender = await ctx.db.get(userId);
    await ctx.db.insert("alarmMessages", {
      alarmId: args.alarmId,
      senderId: userId,
      senderName: sender?.name ?? "Anggota",
      text,
      createdAt: new Date().toISOString(),
    });
  },
});
