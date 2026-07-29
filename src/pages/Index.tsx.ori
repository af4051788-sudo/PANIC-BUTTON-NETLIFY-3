import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useIncomingAlarms } from "@/hooks/use-alarm-context.tsx";
import {
  ShieldAlert, Bell, BellOff, MapPin, Wifi, User,
  LayoutDashboard, ShieldCheck, Users, BarChart2, AlertTriangle, ExternalLink,
  ChevronDown, ChevronUp,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

// ── Triple-tap detection ───────────────────────────────────────────────────────
function useTripleTap(onTripleTap: () => void) {
  const taps = useRef<number[]>([]);
  return useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 600), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      onTripleTap();
    }
  }, [onTripleTap]);
}

// ── Standby idle animation: ripple rings ─────────────────────────────────────
function StandbyRipples() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full border border-primary/20"
          style={{ margin: `-${(i + 1) * 28}px` }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 3, delay: i * 1, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </>
  );
}

// ── Incoming alarm ripple — alert animation when group member needs help ──────
function IncomingAlarmRipples() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            inset: `-${(i + 1) * 20}px`,
            border: "2px solid #f59e0b",
            opacity: 0,
          }}
          animate={{
            opacity: [0, 0.7, 0],
            scale: [0.85, 1.3, 1.3],
          }}
          transition={{
            duration: 1.8,
            delay: i * 0.4,
            repeat: Infinity,
            ease: "easeOut",
          }}
        />
      ))}
      {/* Rotating dashed ring */}
      <motion.div
        className="absolute rounded-full"
        style={{
          inset: "-32px",
          border: "3px dashed #f59e0b",
          opacity: 0.5,
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
    </>
  );
}

// ── 3D Panic Button ───────────────────────────────────────────────────────────
interface PanicBtnProps {
  isAlarmActive: boolean;
  hasIncoming: boolean;
  incomingNames: string[];
  alarmType: "panic" | "silent" | null;
  countdown: number | null;
  pressProgress: number;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onClick: () => void;
}

function PanicBtn({
  isAlarmActive,
  hasIncoming,
  incomingNames,
  alarmType,
  countdown,
  pressProgress,
  onPointerDown,
  onPointerUp,
  onClick,
}: PanicBtnProps) {
  const radius = 126;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - pressProgress);

  // Dua status aktif bersamaan (alarm sendiri aktif + ada alarm masuk) →
  // warna tombol bergantian setiap ~1.8 detik sebagai tanda "mode ganda".
  const isDualMode = isAlarmActive && hasIncoming;
  const [dualTick, setDualTick] = useState(false);
  useEffect(() => {
    if (!isDualMode) {
      setDualTick(false);
      return;
    }
    const id = setInterval(() => setDualTick((v) => !v), 1800);
    return () => clearInterval(id);
  }, [isDualMode]);

  const ownColor =
    alarmType === "silent"
      ? { top: "#ca8a04", glow: "#ca8a0460", ring: "#fbbf24", shadow: "#92400e" }
      : { top: "#dc2626", glow: "#dc262680", ring: "#ef4444", shadow: "#7f1d1d" };
  const incomingColor = { top: "#d97706", glow: "#d9770680", ring: "#f59e0b", shadow: "#78350f" };
  const idleColor = { top: "#b91c1c", glow: "#b91c1c50", ring: "#ef4444", shadow: "#450a0a" };

  // Color scheme: mode ganda = bergantian merah/kuning; sendiri aktif = red/yellow;
  // hanya alarm masuk = amber; idle = dark red
  const colorScheme = isDualMode
    ? (dualTick ? incomingColor : ownColor)
    : isAlarmActive
    ? ownColor
    : hasIncoming
    ? incomingColor
    : idleColor;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 280, height: 280 }}>
      {/* Rings */}
      {!isAlarmActive && !hasIncoming && countdown === null && <StandbyRipples />}

      <AnimatePresence>
        {!isAlarmActive && hasIncoming && (
          <IncomingAlarmRipples />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAlarmActive && alarmType === "panic" && (
          <>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border-2"
                style={{ inset: `-${(i + 1) * 22}px`, borderColor: colorScheme.ring }}
                initial={{ opacity: 0.8, scale: 1 }}
                animate={{ opacity: 0, scale: 1.6 }}
                transition={{ duration: 1.4, delay: i * 0.45, repeat: Infinity, ease: "easeOut" }}
              />
            ))}
          </>
        )}
      </AnimatePresence>

      {/* Progress ring */}
      <svg
        className="absolute -rotate-90 pointer-events-none"
        width={280 + 48}
        height={280 + 48}
        viewBox={`0 0 ${280 + 48} ${280 + 48}`}
        style={{ left: -24, top: -24 }}
      >
        <circle cx={(280 + 48) / 2} cy={(280 + 48) / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        {pressProgress > 0 && (
          <circle
            cx={(280 + 48) / 2} cy={(280 + 48) / 2} r={radius}
            fill="none" stroke={colorScheme.ring} strokeWidth="5"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.05s linear" }}
          />
        )}
      </svg>

      {/* Button body */}
      <motion.div
        className="relative cursor-pointer select-none"
        style={{ width: 220, height: 220 }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={onClick}
        whileTap={{ scale: 0.94 }}
        animate={
          isAlarmActive && alarmType === "panic"
            ? { scale: [1, 1.03, 1] }
            : !isAlarmActive && hasIncoming
            ? { scale: [1, 1.04, 1], y: [0, -3, 0] }
            : { scale: 1 }
        }
        transition={
          isAlarmActive && alarmType === "panic"
            ? { duration: 0.6, repeat: Infinity, ease: "easeInOut" }
            : !isAlarmActive && hasIncoming
            ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.15 }
        }
      >
        {/* Shadow */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: colorScheme.shadow, transform: "translateY(10px) scale(0.97)", filter: "blur(2px)", transition: "background 0.7s ease" }}
        />
        {/* Side */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: `linear-gradient(180deg, ${colorScheme.top}cc 0%, ${colorScheme.shadow} 100%)`, transform: "translateY(7px)", transition: "background 0.7s ease" }}
        />
        {/* Glow */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: colorScheme.glow, filter: "blur(24px)", transform: "scale(1.15)", transition: "background 0.7s ease" }}
        />
        {/* Face */}
        <motion.div
          className="absolute inset-0 rounded-full flex flex-col items-center justify-center gap-2 overflow-hidden"
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${colorScheme.ring}cc 0%, ${colorScheme.top} 60%, ${colorScheme.shadow}cc 100%)`,
            boxShadow: `inset 0 2px 8px rgba(255,255,255,0.25), inset 0 -4px 8px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.06)`,
            transition: "background 0.7s ease",
          }}
          whileTap={{ y: 6 }}
          transition={{ duration: 0.1 }}
        >
          {/* Glare */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{ top: "12%", left: "18%", width: "55%", height: "35%", background: "radial-gradient(ellipse at center, rgba(255,255,255,0.35) 0%, transparent 80%)", filter: "blur(3px)" }}
          />

          <AnimatePresence mode="wait">
            {countdown !== null ? (
              <motion.span
                key="countdown"
                className="text-7xl font-black text-white drop-shadow-lg"
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}
              >
                {countdown}
              </motion.span>
            ) : isAlarmActive ? (
              <motion.div key="active" className="flex flex-col items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {alarmType === "silent" ? <BellOff className="size-14 text-white drop-shadow" /> : <Bell className="size-14 text-white drop-shadow" />}
                <span className="text-sm font-black tracking-widest text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
                  {alarmType === "silent" ? "SILENT" : "ALARM"}
                </span>
                <span className="text-xs text-white/70 font-medium">Tekan untuk matikan</span>
                {hasIncoming && (
                  <span className="text-[9px] text-white/80 font-bold mt-0.5 px-2 text-center leading-tight">
                    Ada anggota lain butuh bantuan — lihat di bawah
                  </span>
                )}
              </motion.div>
            ) : hasIncoming ? (
              // Incoming alarm overlay
              <motion.div
                key="incoming"
                className="flex flex-col items-center gap-1 px-3"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
              >
                <motion.div
                  animate={{ rotate: [-8, 8, -8] }}
                  transition={{ duration: 0.4, repeat: Infinity }}
                >
                  <AlertTriangle className="size-10 text-white drop-shadow-lg" />
                </motion.div>
                <span className="text-xs font-black tracking-widest text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
                  BUTUH BANTUAN!
                </span>
                <span className="text-[10px] text-white/90 font-bold text-center leading-tight" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
                  {incomingNames.slice(0, 2).join(", ")}
                </span>
                <span className="text-[9px] text-white/70 font-medium mt-0.5">Lihat & respon di bawah</span>
              </motion.div>
            ) : (
              <motion.div key="idle" className="flex flex-col items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <motion.div
                  animate={{ scale: [1, 1.08, 1], filter: ["brightness(1)", "brightness(1.3)", "brightness(1)"] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <ShieldAlert className="size-14 text-white drop-shadow-lg" />
                </motion.div>
                <span className="text-xl font-black tracking-widest text-white" style={{ textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>
                  PANIC
                </span>
                <span className="text-xs text-white/60 font-medium">Tahan 3 detik</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ── Incoming alarm banner (below button) ─────────────────────────────────────
// Reusable "X orang merespon" pill that expands into a name list. Used both
// on the presser's own active-alarm view and on other members' incoming
// alarm banners. Only renders once at least one person has responded.
function ResponderListButton({ alarmId, responderCount }: { alarmId: string; responderCount: number }) {
  const [open, setOpen] = useState(false);
  const responders = useQuery(
    api.groups.getAlarmResponders,
    open ? { alarmId: alarmId as Id<"alarms"> } : "skip",
  );

  if (responderCount === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1 hover:bg-emerald-500/20 transition-colors"
      >
        <Users className="size-3" />
        {responderCount} orang merespon
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 space-y-1 overflow-hidden"
          >
            {responders === undefined ? (
              <p className="text-[10px] text-white/50 px-1">Memuat...</p>
            ) : (
              responders.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] bg-white/5 rounded-lg px-2 py-1">
                  <span className="text-white/90 font-medium">{r.name}</span>
                  <span className="text-white/40">
                    {new Date(r.respondedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Shows a "Lihat Lokasi" button once the current user has responded to this
// specific alarm. The query itself is server-gated — it only returns a real
// URL if this user actually has a response record for this alarmId.
function AlarmLocationButton({ alarmId }: { alarmId: string }) {
  const result = useQuery(api.groups.getAlarmLocationForResponder, { alarmId: alarmId as Id<"alarms"> });

  if (!result || !result.revealed) return null;

  return (
    <a
      href={result.mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded-lg px-3 py-2 hover:bg-amber-500/25 transition-colors"
    >
      <MapPin className="size-3.5" />
      Lihat Lokasi
      <ExternalLink className="size-3" />
    </a>
  );
}

function IncomingAlarmBanner({
  alarms,
  onRespond,
}: {
  alarms: Array<{ alarmId: string; userName: string; groupName: string; type: string; respondedByMe: boolean; responderCount: number; isLocationTriggered: boolean }>;
  onRespond: (alarmId: string) => void;
}) {
  return (
    <AnimatePresence>
      {alarms.length > 0 && (
        <motion.div
          className="relative z-20 mt-8 w-full max-w-xs space-y-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
        >
          {alarms.map((a) => (
            <motion.div
              key={a.alarmId}
              className="bg-amber-500/10 border border-amber-500/40 rounded-2xl px-4 py-3"
              animate={{ borderColor: ["rgba(245,158,11,0.4)", "rgba(245,158,11,0.8)", "rgba(245,158,11,0.4)"] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-amber-300 truncate">
                    {a.isLocationTriggered && "📍 "}{a.userName}
                  </p>
                  <p className="text-xs text-amber-400/80">{a.type === "panic" ? "Alarm Panic" : a.type === "silent" ? "Silent Alert" : "Escort"} · {a.groupName}</p>
                </div>
                {a.respondedByMe && (
                  <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/30 rounded-full px-2 py-1 whitespace-nowrap">
                    ✓ Anda merespon
                  </span>
                )}
              </div>

              {!a.respondedByMe && (
                <motion.button
                  type="button"
                  onClick={() => onRespond(a.alarmId)}
                  className="mt-2.5 w-full py-2.5 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] transition-colors text-green-950 font-bold text-sm"
                  animate={{ opacity: [1, 0.55, 1] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                >
                  Saya Merespon
                </motion.button>
              )}

              {a.responderCount > 0 && (
                <ResponderListButton alarmId={a.alarmId} responderCount={a.responderCount} />
              )}
              {a.respondedByMe && <AlarmLocationButton alarmId={a.alarmId} />}
            </motion.div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Main core component ───────────────────────────────────────────────────────
function PanicButtonCore() {
  const navigate = useNavigate();
  const { incomingAlarms, respondToAlarmId } = useIncomingAlarms();
  const [pressProgress, setPressProgress] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [alarmType, setAlarmType] = useState<"panic" | "silent" | null>(null);
  const [currentAlarmId, setCurrentAlarmId] = useState<Id<"alarms"> | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "granted" | "denied">("idle");

  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressStart = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const triggerAlarm = useMutation(api.alarms.triggerAlarm);
  const resolveAlarm = useMutation(api.alarms.resolveAlarm);
  const activeAlarm = useQuery(api.alarms.getMyActiveAlarm, {});
  const customTitle = useQuery(api.groups.getMyPrimaryGroupTitle, {});

  const hasIncoming = incomingAlarms.length > 0;
  const incomingNames = incomingAlarms.map((a) => a.userName);

  useEffect(() => {
    if (activeAlarm) {
      setIsAlarmActive(true);
      setAlarmType(activeAlarm.type as "panic" | "silent");
      setCurrentAlarmId(activeAlarm._id);
    } else {
      setIsAlarmActive(false);
      setAlarmType(null);
      setCurrentAlarmId(null);
    }
  }, [activeAlarm]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationStatus("granted"); },
        () => setLocationStatus("denied"),
      );
    }
  }, []);

  const vibrate = useCallback((pattern: number[]) => {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  }, []);

  const activatePanicAlarm = useCallback(
    async (type: "panic" | "silent") => {
      vibrate([200, 100, 200]);
      try {
        const id = await triggerAlarm({ type, latitude: location?.lat, longitude: location?.lng });
        setCurrentAlarmId(id as Id<"alarms">);
        setIsAlarmActive(true);
        setAlarmType(type);
        if (type === "panic") {
          toast.error("ALARM AKTIF! Sinyal darurat dikirim.", { duration: 5000 });
        } else {
          toast.warning("SILENT ALERT dikirim ke dashboard.", { duration: 5000 });
        }
      } catch {
        toast.error("Gagal mengirim sinyal. Coba lagi.");
      }
    },
    [triggerAlarm, location, vibrate],
  );

  const deactivateAlarm = useCallback(async () => {
    if (!currentAlarmId) return;
    vibrate([100]);
    try {
      await resolveAlarm({ alarmId: currentAlarmId });
      toast.success("Alarm dimatikan. Tetap waspada.");
    } catch {
      toast.error("Gagal mematikan alarm.");
    }
  }, [resolveAlarm, currentAlarmId, vibrate]);

  const handleTripleTap = useCallback(() => {
    if (!isAlarmActive) activatePanicAlarm("silent");
  }, [isAlarmActive, activatePanicAlarm]);

  const onTripleTap = useTripleTap(handleTripleTap);

  const startPress = useCallback(() => {
    if (isAlarmActive) return;
    pressStart.current = Date.now();
    setCountdown(3);
    let cd = 3;
    countdownTimer.current = setInterval(() => {
      cd -= 1;
      setCountdown(cd);
      vibrate([50]);
      if (cd <= 0) {
        clearInterval(countdownTimer.current!);
        setCountdown(null);
        activatePanicAlarm("panic");
      }
    }, 1000);
    const animate = () => {
      const elapsed = Date.now() - pressStart.current;
      const progress = Math.min(elapsed / 3000, 1);
      setPressProgress(progress);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
  }, [isAlarmActive, activatePanicAlarm, vibrate]);

  const cancelPress = useCallback(() => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPressProgress(0);
    setCountdown(null);
  }, []);

  const handleButtonClick = useCallback(() => {
    onTripleTap();
    // Tombol utama HANYA mengontrol alarm milik sendiri — merespon alarm
    // orang lain dilakukan lewat tombol eksplisit di banner, supaya tidak
    // pernah ambigu saat kedua status terjadi bersamaan (alarm sendiri aktif
    // + ada alarm masuk dari orang lain).
    if (isAlarmActive) {
      deactivateAlarm();
      return;
    }
  }, [onTripleTap, isAlarmActive, deactivateAlarm]);

  const handleRespondToAlarm = useCallback(
    (alarmId: string) => {
      respondToAlarmId(alarmId);
      vibrate([100, 50, 100]);
      toast.success("Anda merespon alarm. Lokasi anggota tersebut kini tersedia di bawah.");
    },
    [respondToAlarmId, vibrate],
  );

  const displayTitle = customTitle ?? "PANIC BUTTON";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background px-4 select-none pb-20">
      {/* Title */}
      <motion.div
        className="mb-6 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <motion.div
          className="flex items-center justify-center gap-2 mb-1"
          animate={{
            textShadow: isAlarmActive
              ? ["0 0 8px #ef444480", "0 0 24px #ef4444cc", "0 0 8px #ef444480"]
              : hasIncoming
              ? ["0 0 8px #f59e0b80", "0 0 24px #f59e0bcc", "0 0 8px #f59e0b80"]
              : "none",
          }}
          transition={{ duration: 1.2, repeat: (isAlarmActive || hasIncoming) ? Infinity : 0 }}
        >
          <ShieldAlert
            className="size-7"
            style={{ color: hasIncoming ? "#f59e0b" : isAlarmActive ? "#ef4444" : "oklch(0.62 0.26 25)" }}
          />
          <h1
            className="text-xl font-black tracking-wider leading-tight"
            style={{
              color: hasIncoming ? "#f59e0b" : isAlarmActive ? "#ef4444" : "oklch(0.985 0 0)",
              textShadow: hasIncoming ? "0 0 20px #f59e0b66" : isAlarmActive ? "0 0 20px #ef444466" : "none",
            }}
          >
            {hasIncoming ? "ADA YANG BUTUH BANTUAN" : displayTitle}
          </h1>
        </motion.div>
        <p className="text-muted-foreground text-xs">Sistem Keamanan Komunitas</p>
      </motion.div>

      {/* Status pills */}
      <motion.div className="flex gap-3 mb-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${locationStatus === "granted" ? "border-green-500/30 text-green-400 bg-green-500/10" : "border-border text-muted-foreground"}`}>
          <MapPin className="size-3" />
          {locationStatus === "granted" ? "GPS Aktif" : "GPS Tidak Aktif"}
        </div>
        <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 bg-green-500/10">
          <Wifi className="size-3" />
          Online
        </div>
      </motion.div>

      {/* Button */}
      <motion.div
        initial={{ scale: 0.75, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] as const }}
      >
        <PanicBtn
          isAlarmActive={isAlarmActive}
          hasIncoming={hasIncoming}
          incomingNames={incomingNames}
          alarmType={alarmType}
          countdown={countdown}
          pressProgress={pressProgress}
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onClick={handleButtonClick}
        />
      </motion.div>

      {/* Incoming alarm banners */}
      <IncomingAlarmBanner alarms={incomingAlarms} onRespond={handleRespondToAlarm} />

      {/* Siapa yang sudah merespon alarm SAYA — muncul begitu ada yang merespon */}
      {isAlarmActive && activeAlarm && (
        <div className="relative z-20 mt-8 flex flex-col items-center">
          <ResponderListButton alarmId={activeAlarm._id} responderCount={activeAlarm.responderCount} />
        </div>
      )}

      {/* Hints grid */}
      <AnimatePresence>
        {!hasIncoming && (
          <motion.div
            className="mt-10 text-center space-y-3 max-w-xs w-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.5 }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-xl p-3 text-left">
                <p className="text-xs font-bold text-primary mb-1">TAHAN 3 DETIK</p>
                <p className="text-xs text-muted-foreground">Alarm keras + notifikasi semua petugas</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 text-left">
                <p className="text-xs font-bold text-yellow-400 mb-1">KETUK 3× CEPAT</p>
                <p className="text-xs text-muted-foreground">Silent alert — tanpa bunyi alarm</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active alarm status */}
      <AnimatePresence>
        {isAlarmActive && !hasIncoming && (
          <motion.div
            className={`mt-5 border rounded-xl px-5 py-4 max-w-xs w-full text-center ${alarmType === "silent" ? "bg-yellow-500/10 border-yellow-500/30" : "bg-primary/10 border-primary/30"}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <p className="font-bold text-sm mb-1" style={{ color: alarmType === "silent" ? "#fbbf24" : "oklch(0.62 0.26 25)" }}>
              {alarmType === "silent" ? "Silent Alert Aktif" : "Alarm Darurat Aktif"}
            </p>
            <p className="text-muted-foreground text-xs">
              Sinyal dikirim ke dashboard petugas.{locationStatus === "granted" ? " Lokasi GPS tercatat." : ""}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur border-t border-border flex justify-around py-3 z-20">
        <button className="flex flex-col items-center gap-1 text-primary cursor-pointer">
          <ShieldAlert className="size-5" />
          <span className="text-xs font-medium">Panic</span>
        </button>
        <button onClick={() => navigate("/community")} className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <Users className="size-5" />
          <span className="text-xs">Komunitas</span>
        </button>
        <button onClick={() => navigate("/admin")} className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <LayoutDashboard className="size-5" />
          <span className="text-xs">Admin</span>
        </button>
        <button onClick={() => navigate("/analytics")} className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <BarChart2 className="size-5" />
          <span className="text-xs">Laporan</span>
        </button>
        <button onClick={() => navigate("/profile")} className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <User className="size-5" />
          <span className="text-xs">Profil</span>
        </button>
      </nav>
    </div>
  );
}

// ── Unauthenticated landing ───────────────────────────────────────────────────
function UnauthenticatedView() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background px-6">
      <motion.div className="text-center space-y-6 max-w-sm" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex items-center justify-center w-24 h-24">
            <div className="absolute inset-0 rounded-full" style={{ background: "oklch(0.62 0.26 25)", transform: "translateY(5px)", filter: "blur(12px)", opacity: 0.4 }} />
            <motion.div
              className="relative w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: "radial-gradient(ellipse at 35% 30%, #ef4444cc 0%, #b91c1c 60%, #7f1d1d 100%)", boxShadow: "inset 0 2px 6px rgba(255,255,255,0.2), inset 0 -3px 6px rgba(0,0,0,0.5)" }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <ShieldAlert className="size-9 text-white drop-shadow" />
            </motion.div>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">PANIC BUTTON</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">Sistem keamanan komunitas yang responsif. Masuk untuk mengaktifkan tombol darurat dan terhubung dengan jaringan perlindungan.</p>
        </div>
        <div className="space-y-3 text-left">
          {[
            { icon: ShieldCheck, text: "Alarm real-time ke petugas terdekat" },
            { icon: MapPin, text: "Berbagi lokasi GPS saat darurat" },
            { icon: Bell, text: "Silent alert untuk situasi berbahaya" },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon className="size-4 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">{text}</span>
            </div>
          ))}
        </div>
        <SignInButton className="w-full" />
        <p className="text-xs text-muted-foreground">Dengan masuk, Anda setuju untuk berbagi lokasi saat alarm aktif.</p>
      </motion.div>
    </div>
  );
}

export default function Index() {
  return (
    <>
      <AuthLoading>
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="text-center space-y-4">
            <Skeleton className="w-56 h-56 rounded-full mx-auto" />
            <Skeleton className="h-4 w-32 mx-auto" />
          </div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <UnauthenticatedView />
      </Unauthenticated>
      <Authenticated>
        <PanicButtonCore />
      </Authenticated>
    </>
  );
}
