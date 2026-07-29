import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  ArrowLeft,
  Flame,
  ShieldOff,
  Car,
  Heart,
  HelpCircle,
  BarChart2,
  FileText,
  Clock,
  CheckCircle2,
  Bell,
  BellOff,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const CATEGORIES = [
  { value: "fire", label: "Kebakaran", icon: Flame, color: "text-orange-400" },
  { value: "theft", label: "Pencurian", icon: ShieldOff, color: "text-red-400" },
  { value: "accident", label: "Kecelakaan", icon: Car, color: "text-yellow-400" },
  { value: "medical", label: "Darurat Medis", icon: Heart, color: "text-pink-400" },
  { value: "other", label: "Lainnya", icon: HelpCircle, color: "text-muted-foreground" },
] as const;

type Category = "fire" | "theft" | "accident" | "medical" | "other";

function IncidentReportModal({ alarmId, onClose }: { alarmId: Id<"alarms">; onClose: () => void }) {
  const [category, setCategory] = useState<Category | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = useMutation(api.alarms.submitIncidentReport);

  const handleSubmit = async () => {
    if (!category) return;
    setSubmitting(true);
    try {
      await submit({ alarmId, category, description: description || undefined });
      toast.success("Laporan insiden tersimpan.");
      onClose();
    } catch {
      toast.error("Gagal menyimpan laporan.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="size-5 text-primary" /> Laporan Pasca-Insiden</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Apa yang terjadi? Pilih kategori:</p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map(({ value, label, icon: Icon, color }) => (
              <button key={value} onClick={() => setCategory(value)} className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-sm font-medium transition-colors cursor-pointer text-left ${category === value ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-border/60"}`}>
                <Icon className={`size-4 ${color}`} />{label}
              </button>
            ))}
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Deskripsi singkat (opsional)..." rows={3} className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
          <Button onClick={handleSubmit} disabled={submitting || !category} className="w-full">{submitting ? "Menyimpan..." : "Simpan Laporan"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HourlyChart({ alarms }: { alarms: Array<{ startedAt: string }> }) {
  const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${hour.toString().padStart(2, "0")}:00`,
    count: alarms.filter((a) => new Date(a.startedAt).getHours() === hour).length,
  }));
  const maxCount = Math.max(...hourlyData.map((d) => d.count), 1);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <h3 className="font-bold text-sm text-foreground flex items-center gap-2"><Clock className="size-4 text-primary" /> Pola Waktu Insiden</h3>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={hourlyData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
          <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "oklch(0.6 0.01 60)" }} tickLine={false} axisLine={false} interval={3} />
          <YAxis tick={{ fontSize: 9, fill: "oklch(0.6 0.01 60)" }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "oklch(0.14 0.01 20)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {hourlyData.map((entry, i) => (
              <Cell key={i} fill={entry.count === maxCount && entry.count > 0 ? "oklch(0.62 0.26 25)" : entry.count > 0 ? "oklch(0.62 0.26 25 / 50%)" : "oklch(1 0 0 / 5%)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AlarmHistory() {
  const alarms = useQuery(api.alarms.getRecentAlarms, { limit: 30 });
  const [reportingAlarmId, setReportingAlarmId] = useState<Id<"alarms"> | null>(null);
  const markFalseAlarm = useMutation(api.alarms.markFalseAlarm);

  const handleFalseAlarm = async (alarmId: Id<"alarms">) => {
    try {
      await markFalseAlarm({ alarmId });
      toast.success("Ditandai sebagai alarm palsu.");
    } catch {
      toast.error("Gagal menandai alarm palsu.");
    }
  };

  if (alarms === undefined) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
  }

  const noReport = alarms.filter((a) => a.status === "resolved" && !a.incidentCategory);

  return (
    <div className="space-y-5">
      {alarms.length > 0 && <HourlyChart alarms={alarms} />}

      <AnimatePresence>
        {noReport.length > 0 && (
          <motion.div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 space-y-3" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-sm font-bold text-yellow-400 flex items-center gap-2"><FileText className="size-4" /> {noReport.length} alarm belum dilaporkan</p>
            <Button size="sm" variant="secondary" className="gap-2 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10" onClick={() => setReportingAlarmId(noReport[0]._id)}>
              <FileText className="size-3.5" /> Isi Laporan Sekarang
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Riwayat Alarm Saya</p>
        {alarms.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">Belum ada riwayat alarm.</div>
        ) : (
          alarms.map((alarm) => {
            const cat = CATEGORIES.find((c) => c.value === alarm.incidentCategory);
            const CatIcon = cat?.icon;
            return (
              <div key={alarm._id} className="bg-card border border-border rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {alarm.type === "panic" ? <Bell className="size-4 text-primary" /> : <BellOff className="size-4 text-yellow-400" />}
                    <div>
                      <p className="font-medium text-sm text-foreground">{alarm.type === "panic" ? "Alarm Panic" : alarm.type === "silent" ? "Silent Alert" : "Escort Mode"}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(alarm.startedAt), "d MMM yyyy, HH:mm", { locale: idLocale })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {alarm.status === "resolved" && <CheckCircle2 className="size-4 text-green-400" />}
                    {CatIcon && <CatIcon className={`size-4 ${cat?.color ?? ""}`} />}
                  </div>
                </div>
                {alarm.responderNote && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-2.5 py-1.5">
                    <p className="text-xs text-green-400">Respon Petugas: {alarm.responderNote}</p>
                  </div>
                )}
                {alarm.status === "resolved" && !alarm.incidentCategory && (
                  <button onClick={() => setReportingAlarmId(alarm._id)} className="text-xs text-yellow-400 underline cursor-pointer">+ Isi laporan insiden</button>
                )}
                {alarm.status === "active" && (
                  <button
                    onClick={() => handleFalseAlarm(alarm._id)}
                    className="text-xs text-muted-foreground underline cursor-pointer hover:text-destructive transition-colors"
                  >
                    Tandai alarm palsu
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {reportingAlarmId && <IncidentReportModal alarmId={reportingAlarmId} onClose={() => setReportingAlarmId(null)} />}
    </div>
  );
}

export default function AnalyticsPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer"><ArrowLeft className="size-5 text-foreground" /></button>
        <div>
          <h1 className="font-bold text-foreground flex items-center gap-2"><BarChart2 className="size-4 text-primary" /> Laporan {"&"} Analitik</h1>
          <p className="text-xs text-muted-foreground">Riwayat dan pola insiden Anda</p>
        </div>
      </div>
      <motion.div className="max-w-lg mx-auto px-4 py-6 pb-24" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Authenticated><AlarmHistory /></Authenticated>
      </motion.div>
    </div>
  );
}
