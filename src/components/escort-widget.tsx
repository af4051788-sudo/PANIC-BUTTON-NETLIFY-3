import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { motion, AnimatePresence } from "motion/react";
import { Navigation, ChevronUp, ChevronDown } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

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
  const confirmSafe = useMutation(api.groups.confirmEscortSafe);
  const stopEscort = useMutation(api.groups.stopEscortMode);
  const [expanded, setExpanded] = useState(false);
  const [, forceTick] = useState(0);

  const isEscort = activeAlarm?.type === "escort" && activeAlarm.status === "active";

  useEffect(() => {
    if (!isEscort) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isEscort]);

  if (!isEscort || !activeAlarm.nextCheckinAt) return null;

  const secondsLeft = Math.max(0, Math.round((new Date(activeAlarm.nextCheckinAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const isUrgent = secondsLeft < 60;

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
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Navigation className="size-4 text-white" />
          </motion.div>
          <span className="text-xs font-bold text-white flex-1 text-left">Escort Mode Aktif</span>
          <span className="text-sm font-black text-white tabular-nums">
            {minutes}:{seconds.toString().padStart(2, "0")}
          </span>
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
                  Konfirmasi "Aman" sebelum waktu habis, atau alarm darurat otomatis aktif & kontak darurat dihubungi.
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
