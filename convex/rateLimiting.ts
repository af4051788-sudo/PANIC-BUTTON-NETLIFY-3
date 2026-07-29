import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

/**
 * Named, typed rate limits for every user- or device-facing write that could
 * otherwise be spammed or brute-forced. All limits use "token bucket" so a
 * genuine burst (e.g. re-pressing panic a couple of times while fleeing) is
 * still allowed, while sustained abuse gets throttled.
 *
 * Keep these generous enough that a real emergency is never blocked — the
 * goal is stopping automated abuse, not slowing down a person in danger.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // A person triggering their own alarm (panic/silent/escort). Allows a
  // burst of 5 (e.g. accidental double-taps, retries on flaky connection),
  // refilling at 10/hour after that — far above any legitimate use pattern.
  createAlarm: { kind: "token bucket", rate: 10, period: HOUR, capacity: 5 },

  // Joining a group by invite code — throttles brute-forcing the 6-char
  // code. 5 attempts per minute, refilling slowly, is plenty for a human
  // mistyping a code a few times.
  joinGroup: { kind: "token bucket", rate: 5, period: MINUTE, capacity: 5 },

  // A member pressing "Saya Merespon" on someone else's alarm. Generous,
  // since responding is a one-tap action people may retry if the network
  // hiccups, or do for several concurrent alarms.
  respondToAlarm: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 10 },

  // Per-device IoT hardware calls (Wemos). Heartbeat happens routinely, so
  // it gets a higher ceiling than the alarm-toggle endpoints.
  deviceHeartbeat: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 10 },
  deviceAlarmToggle: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 5 },
});
