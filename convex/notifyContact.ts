import { internalAction, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel.js";

// ── Internal read/write helpers (default runtime — these need ctx.db) ───────

export const getAlarmForNotification = internalQuery({
  args: { alarmId: v.id("alarms") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    alarm: {
      _id: Id<"alarms">;
      type: string;
      status: string;
      latitude?: number;
      longitude?: number;
      emergencyContactNotifiedAt?: string;
    };
    owner: {
      name: string;
      emergencyContact?: string;
      emergencyContactName?: string;
      locationPrivacy: string;
    };
  } | null> => {
    const alarm = await ctx.db.get(args.alarmId);
    if (!alarm) return null;
    const owner = await ctx.db.get(alarm.userId);
    if (!owner) return null;

    return {
      alarm: {
        _id: alarm._id,
        type: alarm.type,
        status: alarm.status,
        latitude: alarm.latitude,
        longitude: alarm.longitude,
        emergencyContactNotifiedAt: alarm.emergencyContactNotifiedAt,
      },
      owner: {
        name: owner.name ?? "Seseorang",
        emergencyContact: owner.emergencyContact,
        emergencyContactName: owner.emergencyContactName,
        locationPrivacy: owner.locationPrivacy ?? "precise",
      },
    };
  },
});

export const markEmergencyContactNotified = internalMutation({
  args: { alarmId: v.id("alarms") },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.alarmId, {
      emergencyContactNotifiedAt: new Date().toISOString(),
    });
  },
});

// ── Message building (pure function, easy to unit test) ─────────────────────

const ALARM_LABEL: Record<string, string> = {
  panic: "menekan tombol PANIC",
  silent: "mengaktifkan alarm senyap",
  escort: "mode kawal-nya tidak dikonfirmasi aman",
};

export function buildEmergencyMessage(params: {
  ownerName: string;
  alarmType: string;
  latitude?: number;
  longitude?: number;
  locationPrivacy: string;
}): string {
  const action = ALARM_LABEL[params.alarmType] ?? "mengaktifkan alarm darurat";
  const lines = [
    `🚨 PERINGATAN DARURAT`,
    ``,
    `${params.ownerName} baru saja ${action} di aplikasi PANIC BUTTON dan belum dikonfirmasi aman.`,
  ];

  if (params.locationPrivacy === "anonymous" || params.latitude === undefined || params.longitude === undefined) {
    lines.push(``, `Lokasi tidak tersedia/dibagikan. Segera coba hubungi ${params.ownerName} langsung.`);
  } else if (params.locationPrivacy === "area") {
    // Round to ~2 decimals (~1.1km precision) — rough area, not exact spot.
    const lat = Math.round(params.latitude * 100) / 100;
    const lng = Math.round(params.longitude * 100) / 100;
    lines.push(``, `Perkiraan area: https://maps.google.com/?q=${lat},${lng}`);
  } else {
    lines.push(``, `Lokasi: https://maps.google.com/?q=${params.latitude},${params.longitude}`);
  }

  lines.push(``, `Pesan otomatis dari PANIC BUTTON — Sistem Keamanan Komunitas.`);
  return lines.join("\n");
}

// ── Fonnte sender (plain fetch — no Node built-ins needed, so no "use node") ─

async function sendViaFonnte(target: string, message: string) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    console.warn(
      "FONNTE_TOKEN belum di-set di Convex dashboard — lewati notifikasi WhatsApp kontak darurat.",
    );
    return { ok: false, reason: "not_configured" as const };
  }

  // Fonnte expects Indonesian numbers without a leading 0 (e.g. 6281234567890).
  const normalized = target.trim().replace(/[^\d]/g, "").replace(/^0/, "62");

  const res = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target: normalized, message }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Fonnte send failed:", res.status, text);
    return { ok: false, reason: "http_error" as const };
  }
  return { ok: true as const };
}

/**
 * Scheduled from alarms.ts / iot.ts (after a grace period) and from
 * scheduler.ts (on escort auto-escalation). Re-checks the alarm's current
 * status before sending, so nothing goes out if the user already resolved
 * it or marked it a false alarm in the meantime.
 */
export const sendEmergencyContactAlert = internalAction({
  args: { alarmId: v.id("alarms") },
  handler: async (
    ctx,
    args,
  ): Promise<{ sent: boolean; reason?: string }> => {
    const data = await ctx.runQuery(internal.notifyContact.getAlarmForNotification, {
      alarmId: args.alarmId,
    });
    if (!data) return { sent: false, reason: "alarm_not_found" };
    if (data.alarm.status !== "active") return { sent: false, reason: "already_resolved" };
    if (data.alarm.emergencyContactNotifiedAt) return { sent: false, reason: "already_notified" };
    if (!data.owner.emergencyContact) return { sent: false, reason: "no_emergency_contact" };

    const message = buildEmergencyMessage({
      ownerName: data.owner.name,
      alarmType: data.alarm.type,
      latitude: data.alarm.latitude,
      longitude: data.alarm.longitude,
      locationPrivacy: data.owner.locationPrivacy,
    });

    const result = await sendViaFonnte(data.owner.emergencyContact, message);
    if (result.ok) {
      await ctx.runMutation(internal.notifyContact.markEmergencyContactNotified, {
        alarmId: args.alarmId as Id<"alarms">,
      });
    }
    return { sent: result.ok, reason: result.ok ? undefined : result.reason };
  },
});
