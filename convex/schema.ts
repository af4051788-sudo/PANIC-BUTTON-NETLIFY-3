import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Extend authTables.users dengan field app-specific kita.
  // authTables sudah include: name, email, emailVerificationTime, image, isAnonymous, phone, phoneVerificationTime
  ...authTables,
  users: defineTable({
    ...authTables.users.validator.fields,
    emergencyContact: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    locationPrivacy: v.optional(v.string()),
    role: v.optional(v.string()), // "admin" | "user"
    // Fase 6: bukti otomatis saat panic — WAJIB izin eksplisit (getUserMedia
    // browser tetap akan minta izin terpisah tiap kali walau ini true; field
    // ini cuma preferensi "boleh dicoba", bukan bypass izin OS/browser).
    evidenceCaptureEnabled: v.optional(v.boolean()),
    evidenceCaptureTypes: v.optional(
      v.array(v.union(v.literal("photo"), v.literal("audio"), v.literal("video"))),
    ),
    evidenceCaptureDurationSec: v.optional(v.number()),
    // Fase 7: kontrol proteksi salah pencet tombol panic.
    // panicHoldDurationSec: berapa detik user harus tekan-tahan sebelum
    // sinyal panic terkirim (proteksi di sisi KLIEN, sebelum request
    // dikirim ke server — beda dari rate limiter server di bawah).
    panicHoldDurationSec: v.optional(v.number()),
    // rateLimiterEnabled: kalau false, server SKIP pengecekan rate limit
    // untuk createAlarm milik user ini. Default true (aman). User yang
    // paham risikonya (misal sering latihan/testing) bisa mematikannya
    // sendiri agar tidak pernah diblokir sistem saat kondisi darurat asli.
    panicRateLimiterEnabled: v.optional(v.boolean()),
  })
    // Index ini WAJIB ada — @convex-dev/auth pakai ini untuk lookup user
    // saat sign-in/sign-up. Hilang = login/register akan gagal diam-diam.
    .index("email", ["email"])
    .index("phone", ["phone"]),

  devices: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    name: v.string(),
    pairingCode: v.string(),
    isOnline: v.boolean(),
    lastHeartbeat: v.optional(v.string()),
    wifiStrength: v.optional(v.number()),
    batteryLevel: v.optional(v.number()),
    // "personal" (default, backward compatible) = milik satu user, dipasang
    // di rumahnya. "community" = milik grup (Pos Satpam/Kantor RT/RW/Fasum),
    // tombol fisiknya memicu alarm atas nama LOKASI, bukan atas nama orang.
    deviceType: v.optional(v.union(v.literal("personal"), v.literal("community"))),
    locationLabel: v.optional(v.string()), // "Pos Satpam Blok A", dst — hanya untuk community
    groupId: v.optional(v.id("groups")), // wajib diisi untuk device community
  })
    .index("by_user", ["userId"])
    .index("by_device_id", ["deviceId"])
    .index("by_group", ["groupId"]),

  alarms: defineTable({
    userId: v.id("users"),
    deviceId: v.optional(v.string()),
    type: v.union(v.literal("panic"), v.literal("silent"), v.literal("escort")),
    status: v.union(
      v.literal("active"),
      v.literal("resolved"),
      v.literal("false_alarm"),
    ),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationArea: v.optional(v.string()),
    startedAt: v.string(),
    resolvedAt: v.optional(v.string()),
    isEscalated: v.boolean(),
    incidentCategory: v.optional(v.string()),
    reportDescription: v.optional(v.string()),
    responderNote: v.optional(v.string()),
    groupId: v.optional(v.id("groups")),
    alarmRecipients: v.optional(v.array(v.id("users"))),
    emergencyContactNotifiedAt: v.optional(v.string()),
    // Fase 5: jaringan Wemos multi-device
    targetDeviceIds: v.optional(v.array(v.id("devices"))), // device mana saja yg harus bunyi
    isLocationTriggered: v.optional(v.boolean()), // true kalau dipicu tombol fisik device community
    triggerLocationLabel: v.optional(v.string()), // "Pos Satpam Blok A" — ditampilkan ganti nama user
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),

  groups: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    adminId: v.id("users"),
    inviteCode: v.string(),
    buttonTitle: v.optional(v.string()),
  }).index("by_invite_code", ["inviteCode"]),

  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(), // "admin" | "member"
    lastLocation: v.optional(
      v.object({
        lat: v.number(),
        lng: v.number(),
        updatedAt: v.string(),
      }),
    ),
    alarmRecipients: v.optional(v.array(v.id("users"))),
    muteAlarmSound: v.optional(v.boolean()),
  })
    .index("by_group", ["groupId"])
    .index("by_user", ["userId"])
    .index("by_group_and_user", ["groupId", "userId"]),

  broadcasts: defineTable({
    senderId: v.id("users"),
    senderName: v.optional(v.string()),
    groupId: v.optional(v.id("groups")),
    message: v.string(),
    sentAt: v.string(),
  }).index("by_sender", ["senderId"]),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  // Siapa saja yang menekan "Saya Merespon" untuk sebuah alarm. Dipakai untuk:
  // (1) indikator "X sudah merespon" ke semua anggota grup, dan
  // (2) membuka akses lokasi HANYA untuk anggota yang benar-benar merespon.
  alarmResponses: defineTable({
    alarmId: v.id("alarms"),
    responderId: v.id("users"),
    respondedAt: v.string(),
  })
    .index("by_alarm", ["alarmId"])
    .index("by_alarm_and_user", ["alarmId", "responderId"]),

  // Fase 5: siapa/apa yang jadi "pemicu" (user menekan app, atau device
  // komunal menekan tombol fisik) punya daftar device mana saja yang harus
  // ikut bunyi. Kalau tidak ada baris untuk (ownerType, ownerId, category),
  // dipakai default yang dihitung on-the-fly (lihat convex/alarmTargets.ts).
  alarmTargetPreferences: defineTable({
    ownerType: v.union(v.literal("user"), v.literal("device")),
    ownerId: v.string(), // Id<"users"> atau Id<"devices"> (disimpan sbg string)
    category: v.union(v.literal("panic_silent"), v.literal("escort")),
    targetDeviceIds: v.array(v.id("devices")),
  }).index("by_owner", ["ownerType", "ownerId", "category"]),

  // Fase 6: bukti otomatis (foto/audio/video singkat) yang diambil saat
  // panic ditekan, HANYA kalau user sudah eksplisit mengizinkan di Profil.
  alarmEvidence: defineTable({
    alarmId: v.id("alarms"),
    userId: v.id("users"),
    type: v.union(v.literal("photo"), v.literal("audio"), v.literal("video")),
    storageId: v.id("_storage"),
    capturedAt: v.string(),
  }).index("by_alarm", ["alarmId"]),
});
