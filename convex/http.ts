import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth routes (sign in, sign out, session)
auth.addHttpRoutes(http);

function statusFor(result: { rateLimited?: boolean }): number {
  return result.rateLimited ? 429 : 200;
}

// Heartbeat from Wemos D1
http.route({
  path: "/wemos/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as { deviceId: string; pairingCode: string; wifi?: number; battery?: number };
    const result = await ctx.runMutation(internal.iot.heartbeat, {
      deviceId: body.deviceId,
      pairingCode: body.pairingCode,
      wifiStrength: body.wifi,
      batteryLevel: body.battery,
    });
    return new Response(JSON.stringify(result), {
      status: statusFor(result),
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Alarm ON
http.route({
  path: "/wemos/alarm/on",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as { deviceId: string; pairingCode: string; type: "panic" | "silent" };
    const result = await ctx.runMutation(internal.iot.activateAlarm, {
      deviceId: body.deviceId,
      pairingCode: body.pairingCode,
      type: body.type ?? "panic",
    });
    return new Response(JSON.stringify(result), {
      status: statusFor(result),
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Alarm OFF
http.route({
  path: "/wemos/alarm/off",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as { deviceId: string; pairingCode: string };
    const result = await ctx.runMutation(internal.iot.deactivateAlarm, {
      deviceId: body.deviceId,
      pairingCode: body.pairingCode,
    });
    return new Response(JSON.stringify(result), {
      status: statusFor(result),
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Escalate alarm
http.route({
  path: "/wemos/alarm/escalate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as { deviceId: string; pairingCode: string };
    const result = await ctx.runMutation(internal.iot.escalateAlarm, {
      deviceId: body.deviceId,
      pairingCode: body.pairingCode,
    });
    return new Response(JSON.stringify(result), {
      status: statusFor(result),
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Alarm status polling
http.route({
  path: "/wemos/alarm/status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId") ?? "";
    const pairingCode = url.searchParams.get("pairingCode") ?? "";
    const result = await ctx.runQuery(internal.iot.getAlarmStatus, { deviceId, pairingCode });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Alarm status LONG-POLL — versi hybrid untuk mengurangi jumlah request dari
// Wemos secara drastis. Endpoint LAMA (/wemos/alarm/status) di atas TETAP ADA
// dan tidak berubah sama sekali, supaya firmware lama tetap jalan tanpa
// perlu upgrade. Ini endpoint TAMBAHAN, opsional dipakai firmware baru.
//
// Cara kerja: request DITAHAN (tidak langsung dijawab) sampai salah satu dari
// dua hal terjadi — (a) ada alarm yang menargetkan device ini, dijawab SAAT
// ITU JUGA (nyaris instan), atau (b) 25 detik berlalu tanpa alarm, dijawab
// "aman" dan device diharapkan langsung buka koneksi baru lagi. Idle-wait di
// server ini TIDAK memakan CPU (cuma nunggu), jadi tidak menambah beban biaya
// berarti dibanding polling singkat — yang berkurang drastis adalah JUMLAH
// requestnya, bukan cost per requestnya.
http.route({
  path: "/wemos/alarm/status/longpoll",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId") ?? "";
    const pairingCode = url.searchParams.get("pairingCode") ?? "";

    const CHECK_INTERVAL_MS = 2000; // seberapa sering cek ulang status di database selama menahan
    const MAX_WAIT_MS = 25000; // total maksimal request ini ditahan sebelum dipaksa dijawab
    const deadline = Date.now() + MAX_WAIT_MS;

    let result = await ctx.runQuery(internal.iot.getAlarmStatus, { deviceId, pairingCode });

    // deviceId/pairingCode salah — jangan ditahan sama sekali, langsung balas
    // supaya device tahu ada masalah pairing dan bisa tampilkan errornya.
    if (!result.ok) {
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    while (!result.alarmActive && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
      result = await ctx.runQuery(internal.iot.getAlarmStatus, { deviceId, pairingCode });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ── Community device (Pos Satpam/Kantor RT/RW/Fasum) — tombol fisik memicu
// alarm atas nama LOKASI, bukan atas nama satu orang. Endpoint status
// polling TETAP sama (/wemos/alarm/status) — device apa pun cukup pakai satu
// endpoint status yang sama karena modelnya sudah berbasis target list.

// Community alarm ON
http.route({
  path: "/wemos/community/alarm/on",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as { deviceId: string; pairingCode: string; type: "panic" | "silent" };
    const result = await ctx.runMutation(internal.iot.activateCommunityAlarm, {
      deviceId: body.deviceId,
      pairingCode: body.pairingCode,
      type: body.type ?? "panic",
    });
    return new Response(JSON.stringify(result), {
      status: statusFor(result),
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Community alarm OFF
http.route({
  path: "/wemos/community/alarm/off",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as { deviceId: string; pairingCode: string };
    const result = await ctx.runMutation(internal.iot.deactivateCommunityAlarm, {
      deviceId: body.deviceId,
      pairingCode: body.pairingCode,
    });
    return new Response(JSON.stringify(result), {
      status: statusFor(result),
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
