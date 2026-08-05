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
    // Durasi Escort Mode sebelum harus konfirmasi "Aman" lagi — 1-180 menit,
    // default 6 kalau belum diset (sesuai perilaku sebelumnya).
    escortDurationMinutes: v.optional(v.number()),
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
    // "wemos" (default, backward compatible) = device fisik custom, komunikasi
    // via HTTP polling. "tuya_smartplug" = colokan pintar pabrikan, OUTPUT-ONLY
    // (tidak ada tombol trigger), dikontrol lewat Tuya Cloud API — tidak polling
    // sama sekali, hanya dipanggil saat ada alarm nyata.
    outputMethod: v.optional(v.union(v.literal("wemos"), v.literal("tuya_smartplug"))),
    tuyaDeviceId: v.optional(v.string()), // ID device di sisi Tuya Cloud, wajib diisi untuk outputMethod "tuya_smartplug"
    // Kode DP (data point) untuk perintah ON/OFF — beda jenis device Tuya
    // beda kodenya: smart plug umumnya "switch_1", smart bulb umumnya
    // "switch_led". Opsional, default "switch_1" kalau tidak diisi (lihat
    // convex/tuya.ts). Cek kode PERSIS punya device kamu lewat Tuya API
    // Explorer → "Query Things Data Model" sebelum registrasi kalau ragu.
    tuyaDpCode: v.optional(v.string()),
    // Fase 8: sensor tambahan di pin input Wemos D1 (pintu/api/air) — 1
    // firmware bisa dukung ketiganya sekaligus, tapi tiap device pilih mana
    // yang benar-benar dipasang & diaktifkan lewat array ini.
    sensorsEnabled: v.optional(v.array(v.union(v.literal("door"), v.literal("fire"), v.literal("flood")))),
    // Status terakhir tiap sensor yang diketahui server — dipakai untuk
    // deteksi PERUBAHAN (edge trigger), bukan cuma level, supaya tidak
    // membuat alarm baru berulang-ulang selama sensor tetap dalam kondisi
    // trigger (misal pintu dibiarkan terbuka lama).
    lastSensorState: v.optional(
      v.object({
        door: v.optional(v.boolean()),
        fire: v.optional(v.boolean()),
        flood: v.optional(v.boolean()),
      }),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_device_id", ["deviceId"])
    .index("by_group", ["groupId"]),

  // Antrian permintaan menghubungkan akun Smart Life komunitas ke Tuya Cloud
  // Project kita. Alurnya 2 arah: pengurus RT ajukan (pending) → admin platform
  // generate QR dari dashboard Tuya lalu upload gambarnya (qr_ready) → pengurus
  // RT scan QR pakai app Smart Life mereka sendiri lalu konfirmasi (linked).
  smartPlugLinkRequests: defineTable({
    groupId: v.id("groups"),
    requestedBy: v.id("users"),
    locationLabel: v.string(), // "Pos Ronda Blok A", dst — buat admin gampang identifikasi
    quantity: v.number(), // perkiraan jumlah smart plug yang mau dihubungkan
    status: v.union(
      v.literal("pending"), // baru diajukan, menunggu admin proses
      v.literal("qr_ready"), // admin sudah generate & upload QR, menunggu discan
      v.literal("linked"), // pengurus RT sudah scan & konfirmasi berhasil
      v.literal("rejected"), // admin menolak (mis. data tidak lengkap)
    ),
    qrImageStorageId: v.optional(v.id("_storage")),
    tuyaUid: v.optional(v.string()), // UID akun Smart Life di Tuya, terisi setelah status "linked"
    note: v.optional(v.string()), // catatan admin, mis. alasan reject
  })
    .index("by_group", ["groupId"])
    .index("by_status", ["status"]),

  alarms: defineTable({
    userId: v.id("users"),
    deviceId: v.optional(v.string()),
    type: v.union(v.literal("panic"), v.literal("silent"), v.literal("escort"), v.literal("sensor")),
    // Diisi kalau type === "sensor" — sensor mana yang trigger. "fire" full
    // siren di semua target (seperti panic), "door"/"flood" cuma notifikasi
    // (seperti silent) karena risiko false-trigger lebih tinggi.
    sensorKind: v.optional(v.union(v.literal("door"), v.literal("fire"), v.literal("flood"))),
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
    // Fase 9: Escort Mode yang benar-benar server-driven (bukan timer di
    // browser) — supaya tetap jalan walau user pindah halaman/tutup app.
    nextCheckinAt: v.optional(v.string()), // kapan konfirmasi "Aman" berikutnya jatuh tempo
    escalationJobId: v.optional(v.id("_scheduled_functions")), // job eskalasi yang sedang terjadwal, dibatalkan & dijadwal ulang tiap konfirmasi "Aman"
    // Durasi yang DIPILIH USER saat memulai escort (dari modal) — disimpan
    // di alarm-nya sendiri, BUKAN dibaca ulang dari setting profil, supaya
    // "Aman" konsisten reset ke durasi yang sama persis tiap kali, bukan
    // balik ke default global.
    escortDurationMinutes: v.optional(v.number()),
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
