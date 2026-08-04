import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "motion/react";
import { Navigation, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";

/**
 * Shortcut cepat Escort Mode — dulunya cuma bisa diakses dari dalam tab
 * Komunitas (susah ditemukan). Ini versi ringkas: tombol kecil + modal
 * simpel (cuma durasi, tanpa pilih penerima manual) supaya gampang diakses
 * dari halaman utama kapan saja. Untuk kontrol lebih detail (pilih siapa
 * saja yang memantau), tetap bisa lewat halaman Komunitas seperti biasa.
 */
export function EscortQuickButton() {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(6);
  const [starting, setStarting] = useState(false);
  const activeAlarm = useQuery(api.alarms.getMyActiveAlarm, {});
  const startEscort = useMutation(api.groups.startEscortMode);

  // Jangan tampilkan tombol kalau Escort Mode (atau alarm lain) sedang aktif
  // — widget global sudah menangani tampilannya, hindari tombol ganda yang
  // membingungkan.
  if (activeAlarm) return null;

  const handleStart = async () => {
    setStarting(true);
    try {
      await startEscort({ durationMinutes: duration });
      toast.success("Escort Mode dimulai! Kelola lewat widget kecil di bawah layar.");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memulai Escort Mode.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-bold cursor-pointer hover:bg-yellow-500/20 transition-colors"
      >
        <Navigation className="size-3.5" /> Escort Mode
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="bg-card border border-yellow-500/30 rounded-2xl p-5 space-y-4 w-full max-w-sm"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Navigation className="size-5 text-yellow-400" />
                  <h3 className="font-bold text-foreground">Mulai Escort Mode</h3>
                </div>
                <button onClick={() => setOpen(false)} className="cursor-pointer text-muted-foreground hover:text-foreground">
                  <X className="size-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Anggota grup kamu akan dipantau otomatis selama perjalanan. Butuh pilih orang tertentu saja? Buka dari halaman Komunitas.
              </p>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-muted-foreground">Durasi Check-in</label>
                  <span className="text-xs font-bold text-foreground">
                    {duration < 60 ? `${duration} menit` : `${(duration / 60).toFixed(duration % 60 === 0 ? 0 : 1)} jam`}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={180}
                  step={1}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full accent-yellow-500"
                />
                <p className="text-[10px] text-muted-foreground">Kalau tidak konfirmasi "Aman" dalam durasi ini, alarm darurat otomatis aktif.</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleStart}
                  disabled={starting}
                  className="flex-1 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white font-bold text-sm py-2.5 rounded-xl cursor-pointer transition-colors"
                >
                  {starting ? "Memulai..." : "Mulai Escort"}
                </button>
                <button onClick={() => setOpen(false)} className="px-4 py-2.5 rounded-xl border border-border text-muted-foreground cursor-pointer text-sm">
                  Batal
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
