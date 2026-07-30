import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  ShieldAlert,
  Activity,
  Cpu,
  Bell,
  BellOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Megaphone,
  MessageSquare,
  Wifi,
  WifiOff,
  Clock,
  LayoutDashboard,
  List,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type AlarmRow = {
  _id: Id<"alarms">;
  type: "panic" | "silent" | "escort";
  status: "active" | "resolved" | "false_alarm";
  startedAt: string;
  resolvedAt?: string;
  isEscalated: boolean;
  latitude?: number;
  longitude?: number;
  incidentCategory?: string;
  responderNote?: string;
  userName: string;
  userEmail?: string;
  deviceName?: string;
};

function StatCard({ label, value, sub, color, icon: Icon }: { label: string; value: number | string; sub?: string; color: string; icon: React.ElementType }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="size-4" />
        </div>
      </div>
      <p className="text-3xl font-black text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function AlarmRowItem({ alarm, onRespond, onForceResolve }: { alarm: AlarmRow; onRespond: (a: AlarmRow) => void; onForceResolve: (id: Id<"alarms">) => void }) {
  const typeColor = alarm.type === "panic"
    ? "text-primary bg-primary/10 border-primary/20"
    : "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";

  const statusIcon = alarm.status === "active" ? (
    <span className="flex items-center gap-1 text-xs text-primary animate-pulse"><Activity className="size-3" /> Aktif</span>
  ) : alarm.status === "resolved" ? (
    <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="size-3" /> Selesai</span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="size-3" /> False Alarm</span>
  );

  return (
    <motion.div className="bg-card border border-border rounded-xl p-4 space-y-3" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} layout>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${typeColor}`}>
              {alarm.type === "panic" ? <span className="flex items-center gap-1"><Bell className="size-3" /> PANIC</span> : <span className="flex items-center gap-1"><BellOff className="size-3" /> SILENT</span>}
            </span>
            {alarm.isEscalated && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full border border-orange-500/30 text-orange-400 bg-orange-500/10 flex items-center gap-1">
                <AlertTriangle className="size-3" /> ESKALASI
              </span>
            )}
            {statusIcon}
          </div>
          <p className="font-bold text-sm text-foreground mt-1 truncate">{alarm.userName}</p>
          {alarm.userEmail && <p className="text-xs text-muted-foreground truncate">{alarm.userEmail}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(alarm.startedAt), { addSuffix: true, locale: idLocale })}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(alarm.startedAt), "HH:mm", { locale: idLocale })}</p>
        </div>
      </div>

      {alarm.latitude && alarm.longitude && (
        <a href={`https://maps.google.com/?q=${alarm.latitude},${alarm.longitude}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline flex items-center gap-1">
          Lihat di Maps ({alarm.latitude.toFixed(4)}, {alarm.longitude.toFixed(4)})
        </a>
      )}

      {alarm.responderNote && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-green-400 font-medium">Catatan Petugas:</p>
          <p className="text-xs text-foreground mt-0.5">{alarm.responderNote}</p>
        </div>
      )}

      {alarm.status === "active" && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 gap-1.5" onClick={() => onRespond(alarm)}>
            <MessageSquare className="size-3.5" /> Tanggapi
          </Button>
          <button onClick={() => onForceResolve(alarm._id)} className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer text-xs">
            Selesaikan
          </button>
        </div>
      )}
    </motion.div>
  );
}

function RespondModal({ alarm, onClose }: { alarm: AlarmRow; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const sendNote = useMutation(api.admin.sendResponderNote);

  const handleSend = async () => {
    if (!note.trim()) return;
    setSending(true);
    try {
      await sendNote({ alarmId: alarm._id, note: note.trim() });
      toast.success("Konfirmasi dikirim ke pengguna.");
      onClose();
    } catch {
      toast.error("Gagal mengirim konfirmasi.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader><DialogTitle>Tanggapi Alarm - {alarm.userName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Tulis catatan konfirmasi yang akan dikirim ke pengguna:</p>
          <div className="grid grid-cols-2 gap-2">
            {["Tim sedang dalam perjalanan", "Lokasi sudah aman", "Tolong tunggu di tempat aman", "Bantuan segera tiba"].map((preset) => (
              <button key={preset} onClick={() => setNote(preset)} className="text-xs text-left px-3 py-2 rounded-lg bg-background hover:bg-accent border border-border transition-colors cursor-pointer">
                {preset}
              </button>
            ))}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Atau tulis pesan sendiri..." className="bg-background border-border" />
          <Button onClick={handleSend} disabled={sending || !note.trim()} className="w-full">
            {sending ? "Mengirim..." : "Kirim Konfirmasi & Selesaikan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const sendBroadcast = useMutation(api.admin.sendBroadcast);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      // No groupId = global broadcast visible to ALL users in their Kotak Siaran
      await sendBroadcast({ message: message.trim() });
      toast.success("Broadcast berhasil dikirim! Semua pengguna dapat membacanya di Kotak Siaran.");
      onClose();
    } catch {
      toast.error("Gagal mengirim broadcast.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Megaphone className="size-5 text-primary" /> Broadcast Alert Global</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3">
            <p className="text-xs text-primary font-medium">Siaran dikirim ke SEMUA pengguna. Dapat dibaca di tab Kotak Siaran pada halaman Komunitas.</p>
          </div>
          <div className="space-y-2">
            {["Waspada! Ada laporan pencurian di area ini.", "Patroli ditingkatkan malam ini. Tetap waspada.", "Situasi sudah aman. Terima kasih atas kewaspadaan Anda."].map((preset) => (
              <button key={preset} onClick={() => setMessage(preset)} className="w-full text-xs text-left px-3 py-2 rounded-lg bg-background hover:bg-accent border border-border transition-colors cursor-pointer">{preset}</button>
            ))}
          </div>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tulis pesan broadcast..." className="bg-background border-border" />
          <Button onClick={handleSend} disabled={sending || !message.trim()} className="w-full gap-2">
            <Megaphone className="size-4" />{sending ? "Mengirim..." : "Kirim Broadcast ke Semua"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Gate: cek apakah user adalah admin ───────────────────────────────────────
function AdminSetupGate({ children }: { children: React.ReactNode }) {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const setFirstAdmin = useMutation(api.admin.setFirstAdmin);
  const [loading, setLoading] = useState(false);

  const handleSetFirstAdmin = async () => {
    setLoading(true);
    try {
      await setFirstAdmin({});
      toast.success("Akun Anda sekarang adalah admin pertama.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Loading — belum tahu status user
  if (currentUser === undefined) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  }

  // User sudah ada tapi belum admin
  if (!currentUser || currentUser.role !== "admin") {
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="size-8 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="font-bold text-lg text-foreground">Akses Admin Diperlukan</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            Akun Anda belum memiliki hak admin. Jika Anda adalah pengguna pertama, klik tombol di bawah untuk menjadi admin pertama.
          </p>
        </div>
        <Button onClick={handleSetFirstAdmin} disabled={loading} className="gap-2">
          <ShieldCheck className="size-4" />
          {loading ? "Memproses..." : "Jadikan Saya Admin Pertama"}
        </Button>
        <p className="text-xs text-muted-foreground">Jika sudah ada admin lain, minta mereka untuk mempromosikan akun Anda.</p>
      </div>
    );
  }

  // User adalah admin — tampilkan dashboard
  return <>{children}</>;
}

function AdminDashboardInner() {
  const [tab, setTab] = useState<"overview" | "alarms" | "devices">("overview");  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [respondingAlarm, setRespondingAlarm] = useState<AlarmRow | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);

  const stats = useQuery(api.admin.getDashboardStats, {});
  const activeAlarms = useQuery(api.admin.getAllActiveAlarms, {});
  const allAlarms = useQuery(api.admin.getAllAlarmsPaginated, {
    status: filterStatus !== "all" ? (filterStatus as "active" | "resolved" | "false_alarm") : undefined,
    type: filterType !== "all" ? (filterType as "panic" | "silent" | "escort") : undefined,
  });
  const devices = useQuery(api.admin.getAllDevicesAdmin, {});
  const forceResolve = useMutation(api.admin.forceResolveAlarm);

  const handleForceResolve = async (id: Id<"alarms">) => {
    try {
      await forceResolve({ alarmId: id });
      toast.success("Alarm diselesaikan.");
    } catch {
      toast.error("Gagal menyelesaikan alarm.");
    }
  };

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {activeAlarms && activeAlarms.length > 0 && (
          <motion.div className="bg-primary/10 border border-primary/40 rounded-xl px-4 py-3 flex items-center gap-3" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="w-3 h-3 rounded-full bg-primary animate-pulse flex-shrink-0" />
            <p className="text-sm font-bold text-primary">{activeAlarms.length} alarm aktif saat ini!</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-1 bg-card rounded-xl p-1 border border-border">
        {[{ id: "overview", label: "Ringkasan", icon: LayoutDashboard }, { id: "alarms", label: "Log Alarm", icon: List }, { id: "devices", label: "Perangkat", icon: Cpu }].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as "overview" | "alarms" | "devices")} className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon className="size-3.5" />{label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          {stats == null ? (
            <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Alarm Hari Ini" value={stats.todayCount} icon={Bell} color="bg-primary/10 text-primary" />
              <StatCard label="Alarm Aktif" value={stats.activeCount} sub="Sedang berlangsung" icon={Activity} color="bg-red-500/10 text-red-400" />
              <StatCard label="Eskalasi" value={stats.escalatedCount} sub="Total keseluruhan" icon={AlertTriangle} color="bg-orange-500/10 text-orange-400" />
              <StatCard label="Rata-rata Respon" value={`${stats.avgResponseMinutes}m`} sub="Waktu penyelesaian" icon={Clock} color="bg-blue-500/10 text-blue-400" />
              <StatCard label="Total Perangkat" value={stats.totalDevices} icon={Cpu} color="bg-purple-500/10 text-purple-400" />
              <StatCard label="Perangkat Online" value={stats.onlineDevices} sub={`dari ${stats.totalDevices}`} icon={Wifi} color="bg-green-500/10 text-green-400" />
            </div>
          )}

          <Button variant="secondary" className="w-full gap-2 border border-dashed border-primary/30 text-primary hover:bg-primary/10" onClick={() => setShowBroadcast(true)}>
            <Megaphone className="size-4" /> Kirim Broadcast ke Semua Pengguna
          </Button>

          {activeAlarms && activeAlarms.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Alarm Aktif Sekarang</p>
              {activeAlarms.map((a) => <AlarmRowItem key={a._id} alarm={a as AlarmRow} onRespond={setRespondingAlarm} onForceResolve={handleForceResolve} />)}
            </div>
          )}
        </div>
      )}

      {tab === "alarms" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-card border-border text-xs flex-1"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="resolved">Selesai</SelectItem>
                <SelectItem value="false_alarm">False Alarm</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="bg-card border-border text-xs flex-1"><SelectValue placeholder="Jenis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                <SelectItem value="panic">Panic</SelectItem>
                <SelectItem value="silent">Silent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {allAlarms === undefined ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
          ) : allAlarms.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Tidak ada alarm yang cocok dengan filter.</div>
          ) : (
            allAlarms.map((a) => <AlarmRowItem key={a._id} alarm={a as AlarmRow} onRespond={setRespondingAlarm} onForceResolve={handleForceResolve} />)
          )}
        </div>
      )}

      {tab === "devices" && (
        <div className="space-y-3">
          {devices === undefined ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          ) : devices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Belum ada perangkat terdaftar.</div>
          ) : (
            devices.map((d) => (
              <div key={d._id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${d.isOnline ? "bg-green-500/10" : "bg-muted"}`}>
                      <Cpu className={`size-4 ${d.isOnline ? "text-green-400" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-foreground">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.ownerName} · {d.deviceId}</p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${d.isOnline ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {d.isOnline ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                    {d.isOnline ? "Online" : "Offline"}
                  </div>
                </div>
                {d.lastHeartbeat && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Heartbeat terakhir: {formatDistanceToNow(new Date(d.lastHeartbeat), { addSuffix: true, locale: idLocale })}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {respondingAlarm && <RespondModal alarm={respondingAlarm} onClose={() => setRespondingAlarm(null)} />}
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
    </div>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer">
          <ArrowLeft className="size-5 text-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-foreground flex items-center gap-2"><ShieldAlert className="size-4 text-primary" /> Admin Dashboard</h1>
          <p className="text-xs text-muted-foreground">Monitoring {"&"} Kontrol Real-time</p>
        </div>
      </div>
      <motion.div className="max-w-2xl mx-auto px-4 py-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Authenticated>
          <AdminSetupGate>
            <AdminDashboardInner />
          </AdminSetupGate>
        </Authenticated>
      </motion.div>
    </div>
  );
}
