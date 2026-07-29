import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Setiap 5 menit: set device offline jika tidak ada heartbeat.
 * Memperbaiki celah di mana field isOnline tidak pernah di-reset ke false.
 */
crons.interval(
  "mark stale devices offline",
  { minutes: 5 },
  internal.scheduler.markStaleDevicesOffline,
  {},
);

export default crons;
