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
