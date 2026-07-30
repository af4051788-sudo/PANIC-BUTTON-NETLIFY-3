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
  // burst of 8 (e.g. accidental double-taps, retries on flaky connection),
  // refilling at 60/hour (~1 per minute) after that — this is deliberately
  // fast: for a panic-button app, a token bucket that refills slowly risks
  // silently blocking a genuine repeated trigger during a real emergency.
  // This limit exists only to stop automated/bot abuse, never to slow down
  // a real person. Users can also disable this entirely for themselves via
  // Profile settings (panicRateLimiterEnabled).
  createAlarm: { kind: "token bucket", rate: 60, period: HOUR, capacity: 8 },

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
