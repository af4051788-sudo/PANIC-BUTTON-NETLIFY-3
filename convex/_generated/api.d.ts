/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as alarmTargets from "../alarmTargets.js";
import type * as alarms from "../alarms.js";
import type * as auth from "../auth.js";
import type * as communityDevices from "../communityDevices.js";
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as evidence from "../evidence.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as iot from "../iot.js";
import type * as notifyContact from "../notifyContact.js";
import type * as push from "../push.js";
import type * as pushSender from "../pushSender.js";
import type * as rateLimiting from "../rateLimiting.js";
import type * as scheduler from "../scheduler.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  alarmTargets: typeof alarmTargets;
  alarms: typeof alarms;
  auth: typeof auth;
  communityDevices: typeof communityDevices;
  crons: typeof crons;
  devices: typeof devices;
  evidence: typeof evidence;
  groups: typeof groups;
  http: typeof http;
  iot: typeof iot;
  notifyContact: typeof notifyContact;
  push: typeof push;
  pushSender: typeof pushSender;
  rateLimiting: typeof rateLimiting;
  scheduler: typeof scheduler;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
