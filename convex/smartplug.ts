import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel.js";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";

function generateDeviceId(): string {
  return "TSP-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function generatePairingCode(): string {
  // Smart plug Tuya tidak dikontrol lewat endpoint /wemos/* jadi pairingCode
  // ini tidak dipakai untuk autentikasi HTTP — cuma mengisi field wajib di
  // skema devices supaya konsisten dengan device Wemos.
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Helper: pastikan user adalah admin GRUP (pengurus RT), bukan admin platform ──
async function requireGroupAdmin(ctx: MutationCtx | QueryCtx, groupId: Id<"groups">, userId: Id<"users">) {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_and_user", (q) => q.eq("groupId", groupId).eq("userId", userId))
    .unique();
  if (!membership || membership.role !== "admin") {
    throw new ConvexError({ message: "Hanya pengurus komunitas yang bisa melakukan ini.", code: "FORBIDDEN" });
  }
  return membership;
}

// ── Helper: pastikan user adalah admin PLATFORM (bukan admin grup) ───────────
async function requirePlatformAdmin(ctx: MutationCtx | QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user || user.role !== "admin") {
    throw new ConvexError({ message: "Akses ditolak. Hanya admin platform.", code: "FORBIDDEN" });
  }
  return user;
}

// ═══════════════════════════════════════════════════════════════════════════
// SISI PENGURUS RT
// ═══════════════════════════════════════════════════════════════════════════

// Layar 3b Step 2 — pengurus RT ajukan permintaan penghubungan smart plug.
export const requestLink = mutation({
  args: {
    groupId: v.id("groups"),
    locationLabel: v.string(),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requireGroupAdmin(ctx, args.groupId, userId);

    if (args.quantity < 1 || args.quantity > 100) {
      throw new ConvexError({ message: "Jumlah smart plug tidak valid.", code: "INVALID_QUANTITY" });
    }

    return await ctx.db.insert("smartPlugLinkRequests", {
      groupId: args.groupId,
      requestedBy: userId,
      locationLabel: args.locationLabel.trim(),
      quantity: args.quantity,
      status: "pending",
    });
  },
});

// Untuk pantau status permintaan komunitas sendiri (badge "Menunggu" / "QR siap" / dst).
export const getMyRequests = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", userId))
      .unique();
    if (!membership) return [];

    return await ctx.db
      .query("smartPlugLinkRequests")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .order("desc")
      .collect();
  },
});

// Layar 3b Step 3 — ambil URL gambar QR yang sudah diupload admin, untuk ditampilkan besar di HP.
export const getQrImageUrl = query({
  args: { requestId: v.id("smartPlugLinkRequests") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const req = await ctx.db.get(args.requestId);
    if (!req || !req.qrImageStorageId) return null;

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", req.groupId).eq("userId", userId))
      .unique();
    if (!membership) return null;

    return await ctx.storage.getUrl(req.qrImageStorageId);
  },
});

// Layar 3b Step 4 — pengurus RT konfirmasi sudah berhasil scan & link di app Smart Life.
export const confirmLinked = mutation({
  args: {
    requestId: v.id("smartPlugLinkRequests"),
    tuyaUid: v.optional(v.string()), // opsional — kalau pengurus RT tahu/copy dari app Smart Life
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const req = await ctx.db.get(args.requestId);
    if (!req) throw new ConvexError({ message: "Permintaan tidak ditemukan.", code: "NOT_FOUND" });
    await requireGroupAdmin(ctx, req.groupId, userId);

    if (req.status !== "qr_ready") {
      throw new ConvexError({ message: "Permintaan ini belum siap untuk dikonfirmasi.", code: "INVALID_STATE" });
    }

    await ctx.db.patch(args.requestId, {
      status: "linked",
      tuyaUid: args.tuyaUid,
    });
  },
});

// Layar 3b Step 4 lanjutan — setelah linked, pengurus RT daftarkan tiap smart
// plug sebagai "device" (kasih nama sendiri, mis. "Sirine Pos Ronda").
export const registerSmartPlugDevice = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.string(),
    tuyaDeviceId: v.string(),
    locationLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requireGroupAdmin(ctx, args.groupId, userId);

    return await ctx.db.insert("devices", {
      userId,
      deviceId: generateDeviceId(),
      name: args.name.trim(),
      pairingCode: generatePairingCode(),
      isOnline: true,
      deviceType: "community",
      locationLabel: args.locationLabel?.trim(),
      groupId: args.groupId,
      outputMethod: "tuya_smartplug",
      tuyaDeviceId: args.tuyaDeviceId,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SISI ADMIN PLATFORM (halaman "Antrian Penghubungan Smart Plug")
// ═══════════════════════════════════════════════════════════════════════════

// Daftar semua permintaan yang masih perlu diproses admin, plus nama grup-nya.
export const getPendingRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") return [];

    const pending = await ctx.db
      .query("smartPlugLinkRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const qrReady = await ctx.db
      .query("smartPlugLinkRequests")
      .withIndex("by_status", (q) => q.eq("status", "qr_ready"))
      .collect();

    const all = [...pending, ...qrReady];
    return await Promise.all(
      all.map(async (r) => {
        const group = await ctx.db.get(r.groupId);
        return { ...r, groupName: group?.name ?? "(grup terhapus)" };
      }),
    );
  },
});

// Admin klik "Proses" → dapat URL upload, lalu upload gambar QR dari dashboard Tuya.
export const generateQrUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requirePlatformAdmin(ctx, userId);
    return await ctx.storage.generateUploadUrl();
  },
});

// Setelah upload selesai, tandai status "qr_ready" + simpan referensi gambarnya.
export const markQrReady = mutation({
  args: {
    requestId: v.id("smartPlugLinkRequests"),
    qrImageStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requirePlatformAdmin(ctx, userId);

    const req = await ctx.db.get(args.requestId);
    if (!req) throw new ConvexError({ message: "Permintaan tidak ditemukan.", code: "NOT_FOUND" });
    if (req.status !== "pending") {
      throw new ConvexError({ message: "Permintaan ini sudah diproses sebelumnya.", code: "INVALID_STATE" });
    }

    await ctx.db.patch(args.requestId, {
      status: "qr_ready",
      qrImageStorageId: args.qrImageStorageId,
    });

    await ctx.scheduler.runAfter(0, internal.pushSender.sendAlarmPush, {
      userIds: [req.requestedBy],
      title: "QR siap, hubungkan smart plug kamu",
      body: `Smart plug untuk "${req.locationLabel}" siap dihubungkan. Tap untuk scan QR.`,
      urgent: false,
    });
  },
});

// Admin tolak permintaan (mis. lokasi tidak jelas, data tidak lengkap).
export const rejectRequest = mutation({
  args: {
    requestId: v.id("smartPlugLinkRequests"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    await requirePlatformAdmin(ctx, userId);

    await ctx.db.patch(args.requestId, {
      status: "rejected",
      note: args.note,
    });
  },
});
