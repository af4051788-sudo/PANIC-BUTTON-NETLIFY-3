"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import crypto from "node:crypto";

/**
 * Integrasi Tuya Cloud API (OpenAPI) untuk kontrol nyala/mati smart plug
 * secara otomatis saat alarm trigger/resolve.
 *
 * WAJIB diset di Convex Dashboard → Settings → Environment Variables:
 *   TUYA_CLIENT_ID       — dari Cloud Project di iot.tuya.com
 *   TUYA_CLIENT_SECRET   — dari Cloud Project yang sama (RAHASIA, jangan bocor)
 *   TUYA_API_ENDPOINT     — endpoint sesuai data center project kamu, contoh:
 *                            https://openapi.tuyaus.com (US)
 *                            https://openapi.tuyaeu.com (EU)
 *                            https://openapi.tuyacn.com (China)
 *                            https://openapi.tuyain.com (India)
 *
 * Referensi algoritma signing: https://developer.tuya.com/en/docs/iot/singnature
 */

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function hmacSha256Upper(str: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(str, "utf8").digest("hex").toUpperCase();
}

function getCredentials() {
  const clientId = process.env.TUYA_CLIENT_ID;
  const clientSecret = process.env.TUYA_CLIENT_SECRET;
  const baseUrl = process.env.TUYA_API_ENDPOINT ?? "https://openapi.tuyaus.com";
  if (!clientId || !clientSecret) {
    throw new Error(
      "TUYA_CLIENT_ID / TUYA_CLIENT_SECRET belum diset di Convex Dashboard → Settings → Environment Variables.",
    );
  }
  return { clientId, clientSecret, baseUrl };
}

/** Ambil access token — signing khusus untuk endpoint token (tanpa access_token). */
async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret, baseUrl } = getCredentials();
  const t = Date.now().toString();
  const method = "GET";
  const path = "/v1.0/token?grant_type=1";
  const contentSha256 = sha256Hex("");
  const stringToSign = [method, contentSha256, "", path].join("\n");
  const sign = hmacSha256Upper(clientId + t + stringToSign, clientSecret);

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { client_id: clientId, sign, sign_method: "HMAC-SHA256", t },
  });
  const data = (await res.json()) as { success: boolean; result?: { access_token: string }; msg?: string; code?: number };
  if (!data.success || !data.result) {
    throw new Error(`Gagal ambil access token Tuya: ${data.msg ?? "unknown error"} (code ${data.code ?? "-"})`);
  }
  return data.result.access_token;
}

/** Panggil endpoint bisnis Tuya (butuh access_token) dengan signing yang sesuai. */
async function callTuyaApi(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const { clientId, clientSecret, baseUrl } = getCredentials();
  const accessToken = await getAccessToken();

  const t = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const contentSha256 = sha256Hex(bodyStr);
  const stringToSign = [method, contentSha256, "", path].join("\n");
  const sign = hmacSha256Upper(clientId + accessToken + t + stringToSign, clientSecret);

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      client_id: clientId,
      access_token: accessToken,
      sign,
      sign_method: "HMAC-SHA256",
      t,
    },
    body: body ? bodyStr : undefined,
  });
  const data = (await res.json()) as { success: boolean; result?: unknown; msg?: string; code?: number };
  if (!data.success) {
    throw new Error(`Tuya API error: ${data.msg ?? "unknown"} (code ${data.code ?? "-"})`);
  }
  return data.result;
}

/**
 * Nyala/matikan SATU smart plug secara langsung. Dipanggil manual dari
 * Convex Dashboard (Functions → Run) untuk TESTING sebelum dihubungkan ke
 * alur alarm — cara paling aman untuk verifikasi credential & device_id
 * benar sebelum dipakai di jalur darurat sungguhan.
 */
export const controlSmartPlugDevice = internalAction({
  args: {
    tuyaDeviceId: v.string(),
    turnOn: v.boolean(),
    dpCode: v.optional(v.string()), // default "switch_1" — sesuaikan kalau device kamu pakai kode lain (lihat API Explorer → Query Things Data Model)
  },
  handler: async (_ctx, args) => {
    const code = args.dpCode ?? "switch_1";
    await callTuyaApi("POST", `/v1.0/iot-03/devices/${args.tuyaDeviceId}/commands`, {
      commands: [{ code, value: args.turnOn }],
    });
  },
});

/**
 * Nyala/matikan SEMUA smart plug Tuya yang termasuk dalam target alarm.
 * Best-effort per device — kalau 1 device gagal (misal offline), device
 * lain tetap lanjut diproses, tidak saling menghentikan.
 */
export const controlSmartPlugsForAlarm = internalAction({
  args: {
    targetDeviceIds: v.array(v.id("devices")),
    turnOn: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const devices = await ctx.runQuery(internal.devices.getTuyaDevicesFromIds, {
      deviceIds: args.targetDeviceIds,
    });
    for (const device of devices) {
      try {
        await callTuyaApi("POST", `/v1.0/iot-03/devices/${device.tuyaDeviceId}/commands`, {
          commands: [{ code: device.tuyaDpCode, value: args.turnOn }],
        });
      } catch (err) {
        // Best-effort: 1 smart plug gagal (misal offline) tidak boleh
        // menghentikan proses untuk device lain, apalagi menggagalkan alarm.
        console.error(`Gagal kontrol Tuya device ${device.tuyaDeviceId}:`, err);
      }
    }
  },
});
