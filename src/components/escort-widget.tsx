import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { motion, AnimatePresence } from "motion/react";
import { Navigation, ChevronUp, ChevronDown } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useEvidenceCapture } from "@/hooks/use-evidence-capture.ts";

/**
 * Widget Escort Mode — ditaruh di AppLayout supaya tampil di SEMUA halaman,
 * bukan cuma di halaman Komunitas. Sumber datanya query live ke server
 * (getMyActiveAlarm), BUKAN state lokal React — jadi kalau user pindah
 * halaman atau tutup-buka app lagi, status & sisa waktunya tetap akurat
 * (dihitung dari field `nextCheckinAt` yang tersimpan di database, bukan
 * dari timer yang bisa hilang saat komponen ke-unmount).
 */
export function EscortWidget() {
  const activeAlarm = useQuery(api.alarms.getMyActiveAlarm, {});
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const confirmSafe = useMutation(api.groups.confirmEscortSafe);
  const stopEscort = useMutation(api.groups.stopEscortMode);
  const { captureAndUpload } = useEvidenceCapture();
  const [expanded, setExpanded] = useState(false);
  const [, forceTick] = useState(0);
  const capturedForAlarmId = useRef<string | null>(null);

  const isEscort = activeAlarm?.type === "escort" && activeAlarm.status === "active";

  useEffect(() => {
    if (!isEscort) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isEscort]);

  // Begitu eskalasi terjadi (timeout tanpa konfirmasi "Aman"), otomatis
  // ambil bukti sesuai pengaturan user — SAMA seperti saat tombol panic
  // ditekan manual. Ini best-effort: cuma jalan kalau app-nya kebetulan
  // masih terbuka di HP saat itu (browser tidak bisa akses kamera/mic dari
  // background/terkunci) — batasan platform, bukan bug.
  useEffect(() => {
    if (!isEscort || !activeAlarm?.isEscalated) return;
    if (capturedForAlarmId.current === activeAlarm._id) return; // sudah pernah capture untuk alarm ini
    capturedForAlarmId.current = activeAlarm._id;
    if (currentUser?.evidenceCaptureEnabled && currentUser.evidenceCaptureTypes?.length) {
      void captureAndUpload(
        activeAlarm._id as Id<"alarms">,
        currentUser.evidenceCaptureTypes,
        currentUser.evidenceCaptureDurationSec ?? 20,
      );
    }
  }, [isEscort, activeAlarm?.isEscalated, activeAlarm?._id, currentUser, captureAndUpload]);

  useEffect(() => {
    if (activeAlarm?.isEscalated) setExpanded(true);
  }, [activeAlarm?.isEscalated]);

  if (!isEscort || !activeAlarm.nextCheckinAt) return null;

  const isEscalated = !!activeAlarm.isEscalated;
  const secondsLeft = Math.max(0, Math.round((new Date(activeAlarm.nextCheckinAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const isUrgent = isEscalated || secondsLeft < 60;

  const handleSafe = async () => {
    try {
      await confirmSafe({ alarmId: activeAlarm._id as Id<"alarms"> });
      toast.success("Dikonfirmasi aman. Timer di-reset.");
    } catch {
      toast.error("Gagal konfirmasi. Coba lagi.");
    }
  };

  const handleStop = async () => {
    try {
      await stopEscort({ alarmId: activeAlarm._id as Id<"alarms"> });
      toast.success("Escort Mode dihentikan. Sampai tujuan dengan selamat!");
      setExpanded(false);
    } catch {
      toast.error("Gagal menghentikan.");
    }
  };

  return (
    <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 w-full max-w-xs">
      <motion.div
        layout
        className={`rounded-2xl border shadow-lg backdrop-blur-md overflow-hidden ${isUrgent ? "bg-destructive/90 border-destructive" : "bg-yellow-600/90 border-yellow-500"}`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer"
        >
          <motion.div
            animate={isEscalated ? { scale: [1, 1.3, 1] } : { scale: [1, 1.15, 1] }}
            transition={{ duration: isEscalated ? 0.6 : 1.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Navigation className="size-4 text-white" />
          </motion.div>
          <span className="text-xs font-bold text-white flex-1 text-left">
            {isEscalated ? "🚨 ALARM AKTIF — Segera Konfirmasi!" : "Escort Mode Aktif"}
          </span>
          {!isEscalated && (
            <span className="text-sm font-black text-white tabular-nums">
              {minutes}:{seconds.toString().padStart(2, "0")}
            </span>
          )}
          {expanded ? <ChevronDown className="size-4 text-white" /> : <ChevronUp className="size-4 text-white" />}
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 pt-1 space-y-2">
                <p className="text-[11px] text-white/80">
                  {isEscalated
                    ? 'Tidak ada konfirmasi tepat waktu — alarm & sirine sudah aktif ke pemantau + device fisik. Tekan "Saya Aman" untuk menghentikannya.'
                    : 'Konfirmasi "Aman" sebelum waktu habis, atau alarm darurat otomatis aktif & kontak darurat dihubungi.'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleSafe}
                    className="flex-1 bg-white text-yellow-700 font-bold text-xs py-2 rounded-lg cursor-pointer"
                  >
                    ✅ Saya Aman
                  </button>
                  <button
                    onClick={handleStop}
                    className="px-3 py-2 rounded-lg border border-white/40 text-white text-xs font-medium cursor-pointer"
                  >
                    Stop
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
