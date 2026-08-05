import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel.d.ts";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { resolveAlarmRecipients } from "./push";
import { rateLimiter } from "./rateLimiting";
import { resolveTargetDeviceIds } from "./alarmTargets";

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export const createGroup = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });

    const inviteCode = generateInviteCode();
    const groupId = await ctx.db.insert("groups", {
      name: args.name,
      description: args.description,
      adminId: userId,
      inviteCode,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role: "admin",
    });

    return { groupId, inviteCode };
  },
});

export const joinGroup = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await rateLimiter.limit(ctx, "joinGroup", { key: userId, throws: true });
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });

    const group = await ctx.db
      .query("groups")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", args.inviteCode))
      .unique();
    if (!group) throw new ConvexError({ message: "Grup tidak ditemukan. Periksa kode undangan.", code: "NOT_FOUND" });

    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", group._id).eq("userId", userId))
      .unique();
    if (existing) throw new ConvexError({ message: "Anda sudah anggota grup ini.", code: "CONFLICT" });

    await ctx.db.insert("groupMembers", {
      groupId: group._id,
      userId,
      role: "member",
    });
  },
});

export const leaveGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", userId))
      .unique();
    if (membership) await ctx.db.delete(membership._id);
  },
});

export const getMyGroups = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const groups = await Promise.all(
      memberships.map(async (m) => {
        const group = await ctx.db.get(m.groupId);
        if (!group) return null;
        const memberCount = (
          await ctx.db
            .query("groupMembers")
            .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
            .collect()
        ).length;
        return {
          ...group,
          role: m.role,
          memberCount,
          alarmRecipients: m.alarmRecipients,
          muteAlarmSound: m.muteAlarmSound ?? false,
        };
      }),
    );
    return groups.filter((g): g is NonNullable<typeof g> => g !== null);
  },
});

export const getGroupMembers = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    return Promise.all(
      members.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          memberId: m._id,
          userId: m.userId,
          name: user?.name ?? "Unknown",
          email: user?.email,
          role: m.role,
          lastLocation: m.lastLocation,
        };
      }),
    );
  },
});

export const getGroupActiveAlarms = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const viewer = await ctx.db.get(userId);
    if (!viewer) return [];

    // Get viewer's membership to check mute setting
    const viewerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId),
      )
      .unique();
    if (!viewerMembership) return []; // not a member of this group

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const alarms = await Promise.all(
      members.map(async (m) => {
        if (m.userId === userId) return null; // skip own alarm in group view

        const alarm = await ctx.db
          .query("alarms")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .filter((q) => q.eq(q.field("status"), "active"))
          .first();
        if (!alarm) return null;

        // Determine effective recipients:
        // - If alarm has explicit recipients (e.g. escort mode), use those
        // - Otherwise use the SENDER's group membership alarmRecipients preference
        const effectiveRecipients = alarm.alarmRecipients ?? m.alarmRecipients;
        if (effectiveRecipients && !effectiveRecipients.includes(userId)) return null;

        const alarmUser = await ctx.db.get(m.userId);
        return {
          ...alarm,
          userName: alarmUser?.name ?? "Unknown",
          muteSound: viewerMembership.muteAlarmSound ?? false,
        };
      }),
    );
    return alarms.filter(Boolean);
  },
});

export const updateMemberLocation = mutation({
  args: {
    groupId: v.id("groups"),
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", userId))
      .unique();
    if (!membership) throw new ConvexError({ message: "Not a member", code: "FORBIDDEN" });

    await ctx.db.patch(membership._id, {
      lastLocation: { lat: args.lat, lng: args.lng, updatedAt: new Date().toISOString() },
    });
  },
});

/**
 * Update which members will receive this user's alarms in a group.
 * alarmRecipients: null = all members, or array of specific user IDs.
 */
export const updateAlarmRecipients = mutation({
  args: {
    groupId: v.id("groups"),
    alarmRecipients: v.union(v.null(), v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", userId))
      .unique();
    if (!membership) throw new ConvexError({ message: "Not a member", code: "FORBIDDEN" });

    await ctx.db.patch(membership._id, {
      alarmRecipients: args.alarmRecipients ?? undefined,
    });
  },
});

/**
 * Toggle mute/unmute alarm sound for this member.
 */
export const toggleMuteAlarmSound = mutation({
  args: {
    groupId: v.id("groups"),
    mute: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", userId))
      .unique();
    if (!membership) throw new ConvexError({ message: "Not a member", code: "FORBIDDEN" });

    await ctx.db.patch(membership._id, { muteAlarmSound: args.mute });
  },
});

export const startEscortMode = mutation({
  args: {
    groupId: v.optional(v.id("groups")),
    alarmRecipients: v.optional(v.array(v.id("users"))),
    durationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await rateLimiter.limit(ctx, "createAlarm", { key: userId, throws: true });

    const targetDeviceIds = await resolveTargetDeviceIds(ctx, { type: "user", id: userId }, "escort");
    const user = await ctx.db.get(userId);
    // Durasi eksplisit dari modal (dipilih user saat itu juga) diprioritaskan
    // di atas default lama di profil — supaya pengaturannya tidak terpisah
    // dan gampang diakses langsung dari modal escort.
    const durationMinutes = args.durationMinutes ?? user?.escortDurationMinutes ?? 6;
    const durationMs = durationMinutes * 60 * 1000;
    const nextCheckinAt = new Date(Date.now() + durationMs).toISOString();

    const id = await ctx.db.insert("alarms", {
      userId,
      type: "escort",
      status: "active",
      startedAt: new Date().toISOString(),
      isEscalated: false,
      groupId: args.groupId,
      alarmRecipients: args.alarmRecipients,
      targetDeviceIds,
      nextCheckinAt,
      escortDurationMinutes: durationMinutes,
    });

    // Auto-eskalasi di server sesuai durasi yang dipilih user (bukan default
    // global) jika tidak konfirmasi "Aman" — ini TIDAK bergantung tab/halaman
    // browser tetap terbuka sama sekali, jalan murni di server.
    const jobId = await ctx.scheduler.runAfter(durationMs, internal.scheduler.autoEscalateEscort, {
      alarmId: id,
    });
    await ctx.db.patch(id, { escalationJobId: jobId });

    const recipients = await resolveAlarmRecipients(ctx, userId, args.alarmRecipients);
    if (recipients.length > 0) {
      const sender = await ctx.db.get(userId);
      await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
        userIds: recipients,
        title: "🚶 Mode Kawal Dimulai",
        body: `${sender?.name ?? "Anggota grup"} mengaktifkan mode kawal. Pantau lokasinya.`,
        alarmId: id,
        urgent: false,
      });
    }
    return id;
  },
});

/**
 * Konfirmasi "Aman" — INI PERBAIKAN dari bug sebelumnya yang salah memanggil
 * resolveAlarm (yang malah mengakhiri alarm escort-nya, padahal usernya
 * masih dalam perjalanan). Sekarang: alarm TETAP aktif, cuma jadwal eskalasi
 * dibatalkan & dijadwalkan ULANG dari sekarang — persis seperti menekan
 * "snooze" pada checkpoint keamanan, bukan mematikan pengawalannya.
 *
 * Juga reset isEscalated ke false — kalau user konfirmasi "Aman" SETELAH
 * sempat ter-eskalasi (alarm sudah terlanjur bunyi), ini yang menghentikan
 * bunyinya (device & tampilan app kembali senyap, lanjut pemantauan normal).
 */
export const confirmEscortSafe = mutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm || alarm.userId !== userId || alarm.type !== "escort" || alarm.status !== "active") return;

    if (alarm.escalationJobId) {
      await ctx.scheduler.cancel(alarm.escalationJobId);
    }

    // PENTING: pakai durasi yang TERSIMPAN DI ALARM ini (dipilih user saat
    // memulai), BUKAN baca ulang dari profil — itu penyebab bug sebelumnya
    // selalu reset ke 6 menit walau usernya set 1 menit.
    const durationMs = (alarm.escortDurationMinutes ?? 6) * 60 * 1000;
    const nextCheckinAt = new Date(Date.now() + durationMs).toISOString();
    const jobId = await ctx.scheduler.runAfter(durationMs, internal.scheduler.autoEscalateEscort, {
      alarmId: args.alarmId,
    });

    // Reset isEscalated juga — kalau user konfirmasi "Aman" SETELAH sempat
    // ter-eskalasi (alarm sudah terlanjur bunyi), ini yang menghentikannya:
    // device & tampilan app kembali senyap, lanjut pemantauan normal.
    await ctx.db.patch(args.alarmId, { nextCheckinAt, escalationJobId: jobId, isEscalated: false });
  },
});

/**
 * Hentikan Escort Mode secara manual (sudah sampai tujuan dengan selamat).
 * Beda dari confirmEscortSafe: ini BENAR-BENAR mengakhiri alarm-nya.
 */
export const stopEscortMode = mutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm || alarm.userId !== userId) return;

    if (alarm.escalationJobId) {
      await ctx.scheduler.cancel(alarm.escalationJobId);
    }
    await ctx.db.patch(args.alarmId, { status: "resolved", resolvedAt: new Date().toISOString() });
  },
});

export const getMyPrimaryGroupTitle = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!memberships) return null;

    const group = await ctx.db.get(memberships.groupId);
    return group?.buttonTitle ?? null;
  },
});

export const updateGroupButtonTitle = mutation({
  args: {
    groupId: v.id("groups"),
    buttonTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const group = await ctx.db.get(args.groupId);
    if (!group) throw new ConvexError({ message: "Group not found", code: "NOT_FOUND" });
    if (group.adminId !== userId)
      throw new ConvexError({ message: "Only admin can update button title", code: "FORBIDDEN" });

    await ctx.db.patch(args.groupId, { buttonTitle: args.buttonTitle });
  },
});

/**
 * Get ALL active alarms visible to the current user across ALL their groups.
 * Used by the global alarm watcher to trigger sound/banner from anywhere in the app.
 */
export const getMyGroupActiveAlarms = query({
  args: {},
  handler: async (ctx): Promise<Array<{ alarmId: string; userName: string; groupName: string; type: string; sensorKind?: string; muteSound: boolean; respondedByMe: boolean; responderCount: number; isLocationTriggered: boolean }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const results: Array<{ alarmId: string; userName: string; groupName: string; type: string; sensorKind?: string; muteSound: boolean; respondedByMe: boolean; responderCount: number; isLocationTriggered: boolean }> = [];
    const seenAlarmIds = new Set<string>();

    for (const myMembership of memberships) {
      const group = await ctx.db.get(myMembership.groupId);
      if (!group) continue;

      const groupMembers = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", myMembership.groupId))
        .collect();

      for (const m of groupMembers) {
        if (m.userId === userId) continue; // skip own alarms

        const alarm = await ctx.db
          .query("alarms")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .filter((q) => q.eq(q.field("status"), "active"))
          .first();
        if (!alarm) continue;
        if (seenAlarmIds.has(alarm._id)) continue; // avoid dupes if shared across multiple groups

        // Escort yang BELUM di-eskalasi (masih dalam masa pemantauan normal,
        // orangnya belum telat konfirmasi "Aman") sengaja TIDAK ditampilkan
        // sebagai alarm aktif ke anggota lain — biar tidak bikin geger dulu.
        // Baru muncul sebagai alarm sungguhan begitu benar-benar ter-eskalasi.
        if (alarm.type === "escort" && !alarm.isEscalated) continue;

        // Alarm dari device komunal (Pos Satpam, dst) tampil ke SEMUA anggota
        // grup, tidak difilter oleh preferensi alarmRecipients pribadi siapa pun
        // (karena tidak ada satu "pemicu" personal di sini).
        if (!alarm.isLocationTriggered) {
          const effectiveRecipients = alarm.alarmRecipients ?? m.alarmRecipients;
          if (effectiveRecipients && !effectiveRecipients.includes(userId)) continue;
        }

        seenAlarmIds.add(alarm._id);

        let displayName: string;
        if (alarm.isLocationTriggered) {
          displayName = alarm.triggerLocationLabel ?? "Lokasi";
        } else {
          const alarmUser = await ctx.db.get(m.userId);
          displayName = alarmUser?.name ?? "Unknown";
        }

        const myResponse = await ctx.db
          .query("alarmResponses")
          .withIndex("by_alarm_and_user", (q) => q.eq("alarmId", alarm._id).eq("responderId", userId))
          .unique();

        const allResponses = await ctx.db
          .query("alarmResponses")
          .withIndex("by_alarm", (q) => q.eq("alarmId", alarm._id))
          .collect();

        results.push({
          alarmId: alarm._id,
          userName: displayName,
          groupName: group.name,
          type: alarm.type,
          sensorKind: alarm.sensorKind,
          muteSound: myMembership.muteAlarmSound ?? false,
          respondedByMe: !!myResponse,
          responderCount: allResponses.length,
          isLocationTriggered: !!alarm.isLocationTriggered,
        });
      }
    }
    return results;
  },
});

/**
 * Can `responderId` respond to `alarm`? Mirrors the same recipient-filtering
 * logic used to decide who sees the alarm in the first place — someone who
 * wouldn't have been shown the alert shouldn't be able to respond to it or
 * unlock its location either.
 */
async function canRespondToAlarm(
  ctx: { db: import("./_generated/server.js").QueryCtx["db"] },
  alarm: { userId: Id<"users">; alarmRecipients?: Id<"users">[] },
  responderId: Id<"users">,
): Promise<boolean> {
  if (alarm.userId === responderId) return false;

  const ownerMemberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", alarm.userId))
    .collect();

  for (const ownerMembership of ownerMemberships) {
    const responderMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", ownerMembership.groupId).eq("userId", responderId),
      )
      .unique();
    if (!responderMembership) continue;

    const effective = alarm.alarmRecipients ?? ownerMembership.alarmRecipients;
    if (effective && !effective.includes(responderId)) continue;

    return true;
  }
  return false;
}

/**
 * A group member presses "Saya Merespon" on someone else's active alarm.
 * Records the response (idempotent — pressing twice is a no-op), then:
 *  - notifies the alarm owner that help is on the way
 *  - notifies the rest of the group that someone has responded
 * The responder's own dashboard can then call getAlarmLocationForResponder
 * to reveal a location link — access is gated server-side by this record,
 * not just hidden in the UI.
 */
/**
 * List of who has responded to an alarm, with timestamps — shown to the
 * alarm owner AND to any group member who could see the alarm in the first
 * place (same visibility rule as getMyGroupActiveAlarms). Names only, no
 * location data here — that stays gated behind getAlarmLocationForResponder.
 */
export const getAlarmResponders = query({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args): Promise<Array<{ name: string; respondedAt: string }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) return [];

    if (alarm.userId !== userId) {
      const isRecipient = await canRespondToAlarm(ctx, alarm, userId);
      if (!isRecipient) return [];
    }

    const responses = await ctx.db
      .query("alarmResponses")
      .withIndex("by_alarm", (q) => q.eq("alarmId", args.alarmId))
      .collect();

    const result: Array<{ name: string; respondedAt: string }> = [];
    for (const r of responses) {
      const responder = await ctx.db.get(r.responderId);
      result.push({ name: responder?.name ?? "Anggota", respondedAt: r.respondedAt });
    }
    return result.sort((a, b) => a.respondedAt.localeCompare(b.respondedAt));
  },
});

export const respondToAlarm = mutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await rateLimiter.limit(ctx, "respondToAlarm", { key: userId, throws: true });

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) throw new ConvexError({ message: "Alarm tidak ditemukan.", code: "NOT_FOUND" });
    if (alarm.status !== "active") return { ok: false };

    const allowed = await canRespondToAlarm(ctx, alarm, userId);
    if (!allowed) throw new ConvexError({ message: "Anda tidak memiliki akses ke alarm ini.", code: "FORBIDDEN" });

    const existing = await ctx.db
      .query("alarmResponses")
      .withIndex("by_alarm_and_user", (q) => q.eq("alarmId", args.alarmId).eq("responderId", userId))
      .unique();
    if (existing) return { ok: true }; // already responded — idempotent no-op

    await ctx.db.insert("alarmResponses", {
      alarmId: args.alarmId,
      responderId: userId,
      respondedAt: new Date().toISOString(),
    });

    const responder = await ctx.db.get(userId);
    const responderName = responder?.name ?? "Seseorang";

    // Reassure the person who's in trouble.
    await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
      userIds: [alarm.userId],
      title: "✅ Bantuan Datang",
      body: `${responderName} akan segera membantu Anda.`,
      alarmId: args.alarmId,
      urgent: false,
    });

    // Let the rest of the group know someone's already on it.
    const allRecipients = await resolveAlarmRecipients(ctx, alarm.userId, alarm.alarmRecipients);
    const others = allRecipients.filter((id) => id !== userId);
    if (others.length > 0) {
      const owner = await ctx.db.get(alarm.userId);
      await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
        userIds: others,
        title: "🙋 Ada yang Merespon",
        body: `${responderName} sudah merespon alarm ${owner?.name ?? "anggota grup"}.`,
        alarmId: args.alarmId,
        urgent: false,
      });
    }

    return { ok: true };
  },
});

/**
 * Reveal the alarm owner's location — ONLY to users who have an actual
 * response record for this alarm. Respects the owner's locationPrivacy
 * setting the same way the emergency-contact WhatsApp fallback does.
 */
export const getAlarmLocationForResponder = query({
  args: { alarmId: v.id("alarms") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { revealed: true; mapsUrl: string }
    | { revealed: false; reason: "not_responded" | "no_location" | "anonymous" }
  > => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { revealed: false, reason: "not_responded" };

    const myResponse = await ctx.db
      .query("alarmResponses")
      .withIndex("by_alarm_and_user", (q) => q.eq("alarmId", args.alarmId).eq("responderId", userId))
      .unique();
    if (!myResponse) return { revealed: false, reason: "not_responded" };

    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) return { revealed: false, reason: "no_location" };

    if (alarm.latitude === undefined || alarm.longitude === undefined) {
      return { revealed: false, reason: "no_location" };
    }

    const owner = await ctx.db.get(alarm.userId);
    const locationPrivacy = owner?.locationPrivacy ?? "precise";
    if (locationPrivacy === "anonymous") {
      return { revealed: false, reason: "anonymous" };
    }

    if (locationPrivacy === "area") {
      const lat = Math.round(alarm.latitude * 100) / 100;
      const lng = Math.round(alarm.longitude * 100) / 100;
      return { revealed: true, mapsUrl: `https://maps.google.com/?q=${lat},${lng}` };
    }

    return {
      revealed: true,
      mapsUrl: `https://maps.google.com/?q=${alarm.latitude},${alarm.longitude}`,
    };
  },
});

/**
 * Get broadcasts visible to this user:
 * - Global broadcasts (no groupId) = all users
 * - Group broadcasts = only group members
 */
export const getMyBroadcasts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get groups user belongs to
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const myGroupIds = memberships.map((m) => m.groupId);

    // Get all recent broadcasts
    const allBroadcasts = await ctx.db
      .query("broadcasts")
      .order("desc")
      .take(100);

    // Filter: global (no groupId) OR user is in that group
    return allBroadcasts.filter((b) => {
      if (!b.groupId) return true; // global broadcast
      return myGroupIds.includes(b.groupId as Id<"groups">);
    });
  },
});

/**
 * Get broadcasts for a specific group (for admin to view in that group's context)
 */
export const getGroupBroadcasts = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const all = await ctx.db
      .query("broadcasts")
      .order("desc")
      .take(200);
    return all.filter(
      (b) => b.groupId === args.groupId || !b.groupId,
    );
  },
});
