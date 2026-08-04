import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import QRCode from "qrcode";
import { QRScannerModal } from "@/components/qr-scanner.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  ArrowLeft,
  Users,
  Plus,
  LogIn,
  Copy,
  MapPin,
  Bell,
  BellOff,
  Navigation,
  UserCheck,
  Shield,
  ChevronRight,
  Activity,
  Megaphone,
  Volume2,
  VolumeX,
  Radio,
  AlertTriangle,
  Settings,
  Check,
  QrCode,
  ScanLine,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

// --- Alarm sound using Web Audio API ---
function playAlarmSound() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
    gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.6);
  } catch {
    // ignore audio errors
  }
}

// --- Recipient Selector ---
type Member = { userId: Id<"users">; name: string; email?: string; role: string };

function RecipientSelector({
  members,
  value,
  onChange,
  adminId,
}: {
  members: Member[];
  value: Id<"users">[] | null; // null = all
  onChange: (val: Id<"users">[] | null) => void;
  adminId?: Id<"users">;
}) {
  const allSelected = value === null;

  const toggleAll = () => onChange(null);

  const toggleMember = (userId: Id<"users">) => {
    const isAdmin = userId === adminId;
    if (allSelected) {
      // Switch to custom: select all except this one
      const others = members.map((m) => m.userId).filter((id) => id !== userId);
      if (isAdmin) {
        // Warn about removing admin
        return;
      }
      onChange(others);
    } else {
      const current = value ?? [];
      if (current.includes(userId)) {
        if (isAdmin) return; // can't deselect admin — handled separately via warning dialog
        onChange(current.filter((id) => id !== userId));
      } else {
        onChange([...current, userId]);
      }
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={toggleAll}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border transition-colors cursor-pointer text-sm font-medium ${
          allSelected
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:border-primary/30"
        }`}
      >
        <span className="flex items-center gap-2"><Users className="size-4" /> Semua Anggota</span>
        {allSelected && <Check className="size-4" />}
      </button>
      {members.map((m) => {
        const selected = allSelected || (value ?? []).includes(m.userId);
        const isAdmin = m.userId === adminId;
        return (
          <div key={m.userId} className="flex items-center gap-2">
            <button
              onClick={() => toggleMember(m.userId)}
              disabled={isAdmin}
              className={`flex-1 flex items-center justify-between px-4 py-2.5 rounded-xl border transition-colors cursor-pointer text-sm ${
                selected
                  ? "border-primary/40 bg-primary/5 text-foreground"
                  : "border-border bg-background text-muted-foreground"
              } ${isAdmin ? "opacity-60 cursor-not-allowed" : "hover:border-primary/30"}`}
            >
              <span className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${selected ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <span>{m.name}</span>
                {isAdmin && <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Admin</span>}
              </span>
              {selected && <Check className="size-4 text-primary" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// --- Admin Deselect Warning Dialog ---
function AdminWarningDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-yellow-400">
            <AlertTriangle className="size-5" /> Peringatan!
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-2">
            <p className="text-sm font-bold text-yellow-400">Anda akan menonaktifkan admin dari penerima alarm!</p>
            <p className="text-xs text-muted-foreground">
              Admin grup adalah responden utama keadaan darurat. Jika admin tidak menerima alarm Anda:
            </p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li className="flex items-start gap-1.5"><span className="text-red-400 mt-0.5">•</span> Alarm darurat Anda mungkin tidak ditangani</li>
              <li className="flex items-start gap-1.5"><span className="text-red-400 mt-0.5">•</span> Respons bantuan bisa terlambat atau tidak datang</li>
              <li className="flex items-start gap-1.5"><span className="text-red-400 mt-0.5">•</span> Tidak ada yang berkoordinasi untuk menolong Anda</li>
            </ul>
          </div>
          <p className="text-sm text-foreground font-medium">Apakah Anda yakin ingin melanjutkan?</p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onCancel} className="flex-1 border border-border">Batal</Button>
            <Button onClick={onConfirm} className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white">Saya Mengerti Risikonya</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Alarm Settings Dialog ---
function AlarmSettingsDialog({
  groupId,
  groupAdminId,
  onClose,
}: {
  groupId: Id<"groups">;
  groupAdminId: Id<"users">;
  onClose: () => void;
}) {
  const groups = useQuery(api.groups.getMyGroups, {});
  const members = useQuery(api.groups.getGroupMembers, { groupId });
  const updateRecipients = useMutation(api.groups.updateAlarmRecipients);
  const toggleMute = useMutation(api.groups.toggleMuteAlarmSound);

  const myGroup = groups?.find((g) => g?._id === groupId);
  const [recipients, setRecipients] = useState<Id<"users">[] | null>(null);
  const [muted, setMuted] = useState(false);
  const [showAdminWarning, setShowAdminWarning] = useState(false);
  const [pendingNoAdmin, setPendingNoAdmin] = useState<Id<"users">[] | null>(null);
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (myGroup && !initialized.current) {
      setRecipients(myGroup.alarmRecipients ?? null);
      setMuted(myGroup.muteAlarmSound ?? false);
      initialized.current = true;
    }
  }, [myGroup]);

  const handleRecipientsChange = (val: Id<"users">[] | null) => {
    // Warn if admin is not in recipients
    const hasAdmin = val === null || val.includes(groupAdminId);
    if (!hasAdmin) {
      setPendingNoAdmin(val);
      setShowAdminWarning(true);
    } else {
      setRecipients(val);
    }
  };

  const handleAdminWarningConfirm = () => {
    setRecipients(pendingNoAdmin);
    setShowAdminWarning(false);
    setPendingNoAdmin(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateRecipients({ groupId, alarmRecipients: recipients });
      await toggleMute({ groupId, mute: muted });
      toast.success("Pengaturan alarm disimpan!");
      onClose();
    } catch {
      toast.error("Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  };

  const memberList: Member[] = (members ?? []).map((m) => ({
    userId: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
  }));

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="bg-card border-border max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="size-5 text-primary" /> Pengaturan Alarm Saya
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {/* Mute toggle */}
            <div className="bg-background border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="font-semibold text-sm text-foreground flex items-center gap-2">
                    {muted ? <VolumeX className="size-4 text-muted-foreground" /> : <Volume2 className="size-4 text-green-400" />}
                    Suara Alarm Anggota Lain
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {muted ? "Notifikasi tanpa suara" : "Berbunyi saat anggota tekan panic button"}
                  </p>
                </div>
                <button
                  onClick={() => setMuted((v) => !v)}
                  className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${muted ? "bg-muted" : "bg-green-600"}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${muted ? "left-0.5" : "left-6"}`} />
                </button>
              </div>
            </div>

            {/* Recipient selection */}
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="font-semibold text-sm text-foreground">Bagikan Alarm Ke:</p>
                <p className="text-xs text-muted-foreground">Pilih siapa yang akan menerima alarm Anda ketika darurat.</p>
              </div>
              {members === undefined ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
              ) : (
                <RecipientSelector
                  members={memberList}
                  value={recipients}
                  onChange={handleRecipientsChange}
                  adminId={groupAdminId}
                />
              )}
              {recipients !== null && !recipients.includes(groupAdminId) && (
                <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
                  <AlertTriangle className="size-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-400">Admin tidak termasuk penerima. Respons darurat mungkin terlambat.</p>
                </div>
              )}
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Menyimpan..." : "Simpan Pengaturan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AdminWarningDialog
        open={showAdminWarning}
        onConfirm={handleAdminWarningConfirm}
        onCancel={() => { setShowAdminWarning(false); setPendingNoAdmin(null); }}
      />
    </>
  );
}

// --- Escort Mode ---
function EscortMode({
  groupId,
  members,
  groupAdminId,
  onStop,
}: {
  groupId?: Id<"groups">;
  members: Member[];
  groupAdminId?: Id<"users">;
  onStop: () => void;
}) {
  const [escortRecipients, setEscortRecipients] = useState<Id<"users">[] | null>(null);
  const [showAdminWarning, setShowAdminWarning] = useState(false);
  const [pendingNoAdmin, setPendingNoAdmin] = useState<Id<"users">[] | null>(null);
  const [starting, setStarting] = useState(false);
  const startEscort = useMutation(api.groups.startEscortMode);

  const handleStart = async () => {
    setStarting(true);
    try {
      await startEscort({ groupId, alarmRecipients: escortRecipients ?? undefined });
      toast.success('Escort Mode dimulai! Kelola lewat widget kecil di bawah layar.');
      onStop(); // tutup form setup — tampilan "aktif" sekarang ditangani EscortWidget global
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memulai Escort Mode.");
    } finally {
      setStarting(false);
    }
  };

  const handleRecipientsChange = (val: Id<"users">[] | null) => {
    const hasAdmin = val === null || !groupAdminId || val.includes(groupAdminId);
    if (!hasAdmin) {
      setPendingNoAdmin(val);
      setShowAdminWarning(true);
    } else {
      setEscortRecipients(val);
    }
  };

  return (
    <motion.div className="bg-card border border-yellow-500/30 rounded-2xl p-5 space-y-4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="flex items-center gap-2">
        <Navigation className="size-5 text-yellow-400" />
        <h3 className="font-bold text-foreground">Pengaturan Escort Mode</h3>
      </div>
      <p className="text-sm text-muted-foreground">Pilih anggota yang akan memantau Anda selama pengawalan.</p>
      <RecipientSelector
        members={members}
        value={escortRecipients}
        onChange={handleRecipientsChange}
        adminId={groupAdminId}
      />
      {escortRecipients !== null && groupAdminId && !escortRecipients.includes(groupAdminId) && (
        <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
          <AlertTriangle className="size-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-400">Admin tidak termasuk. Jika darurat, respons mungkin terlambat.</p>
        </div>
      )}
      <div className="flex gap-3">
        <Button onClick={handleStart} disabled={starting} className="flex-1 gap-2 bg-yellow-600 hover:bg-yellow-700 text-white">
          <Navigation className="size-4" /> {starting ? "Memulai..." : "Mulai Escort"}
        </Button>
        <Button variant="ghost" onClick={onStop} className="border border-border">Batal</Button>
      </div>
      <AdminWarningDialog
        open={showAdminWarning}
        onConfirm={() => { setEscortRecipients(pendingNoAdmin); setShowAdminWarning(false); setPendingNoAdmin(null); }}
        onCancel={() => { setShowAdminWarning(false); setPendingNoAdmin(null); }}
      />
    </motion.div>
  );
}

// --- Broadcasts inbox ---
function BroadcastInbox() {
  const broadcasts = useQuery(api.groups.getMyBroadcasts, {});

  if (broadcasts === undefined) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;
  }

  if (broadcasts.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <Megaphone className="size-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">Belum ada siaran masuk</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {broadcasts.map((b) => (
        <motion.div
          key={b._id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-background border border-border rounded-xl p-4 space-y-1"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Megaphone className="size-3.5 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-xs font-semibold text-primary">{b.senderName ?? "Admin"}</span>
              {!b.groupId && (
                <span className="text-xs bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full">Global</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatDistanceToNow(new Date(b.sentAt), { addSuffix: true, locale: idLocale })}
            </span>
          </div>
          <p className="text-sm text-foreground leading-relaxed">{b.message}</p>
        </motion.div>
      ))}
    </div>
  );
}

// --- Group Detail ---
function GroupDetail({ groupId, onBack }: { groupId: Id<"groups">; onBack: () => void }) {
  const members = useQuery(api.groups.getGroupMembers, { groupId });
  const activeAlarms = useQuery(api.groups.getGroupActiveAlarms, { groupId });
  const groups = useQuery(api.groups.getMyGroups, {});
  const broadcasts = useQuery(api.groups.getGroupBroadcasts, { groupId });
  const leaveGroup = useMutation(api.groups.leaveGroup);
  const updateTitle = useMutation(api.groups.updateGroupButtonTitle);
  const [showEscortSetup, setShowEscortSetup] = useState(false);
  const myActiveAlarm = useQuery(api.alarms.getMyActiveAlarm, {});
  const hasActiveEscort = myActiveAlarm?.type === "escort" && myActiveAlarm.status === "active";
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<"alarm" | "broadcast">("alarm");

  // Play alarm sound when active alarm arrives
  const prevAlarmCount = useRef(0);
  useEffect(() => {
    if (!activeAlarms) return;
    const count = activeAlarms.length;
    if (count > prevAlarmCount.current) {
      const muted = activeAlarms.some((a) => a && a.muteSound);
      if (!muted) playAlarmSound();
    }
    prevAlarmCount.current = count;
  }, [activeAlarms]);

  const group = groups?.find((g) => g?._id === groupId);
  const isAdmin = group?.role === "admin";
  const adminMember = members?.find((m) => m.role === "admin");
  const memberList: Member[] = (members ?? []).map((m) => ({
    userId: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
  }));

  const handleLeave = async () => {
    try {
      await leaveGroup({ groupId });
      toast.success("Anda telah keluar dari grup.");
      onBack();
    } catch {
      toast.error("Gagal keluar dari grup.");
    }
  };

  const handleSaveTitle = async () => {
    if (!newTitle.trim()) return;
    setSavingTitle(true);
    try {
      await updateTitle({ groupId, buttonTitle: newTitle.trim() });
      toast.success("Judul tombol diperbarui!");
      setEditingTitle(false);
    } catch {
      toast.error("Gagal mengubah judul. Hanya admin yang bisa mengubah.");
    } finally {
      setSavingTitle(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <ArrowLeft className="size-4" /> Kembali ke Daftar Grup
        </button>
        <button onClick={() => setShowSettings(true)} className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors cursor-pointer">
          <Settings className="size-3.5" /> Pengaturan Alarm
        </button>
      </div>

      {/* Active Alarm Alert */}
      <AnimatePresence>
        {activeAlarms && activeAlarms.length > 0 && (
          <motion.div className="space-y-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5"><Activity className="size-3.5" /> Alarm Aktif di Grup</p>
            {activeAlarms.map((alarm) => alarm && (
              <div key={alarm._id} className="bg-primary/10 border border-primary/30 rounded-xl p-3 flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 animate-pulse flex-shrink-0" />
                <div>
                  <p className="font-bold text-sm text-foreground">{alarm.userName}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    {alarm.type === "panic" ? <><Bell className="size-3 text-primary" /> Alarm Panic</> : <><BellOff className="size-3 text-yellow-400" /> Silent Alert</>}
                    {" · "}{formatDistanceToNow(new Date(alarm.startedAt), { addSuffix: true, locale: idLocale })}
                  </p>
                  {alarm.latitude && alarm.longitude && (
                    <a href={`https://maps.google.com/?q=${alarm.latitude},${alarm.longitude}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline flex items-center gap-1 mt-1">
                      <MapPin className="size-3" /> Lihat Lokasi
                    </a>
                  )}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin button title settings */}
      {isAdmin && (
        <div className="bg-card border border-primary/20 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">Judul Tombol Darurat</h3>
            </div>
            {!editingTitle && (
              <button onClick={() => { setNewTitle(group?.buttonTitle ?? ""); setEditingTitle(true); }} className="text-xs text-primary border border-primary/30 px-2.5 py-1 rounded-lg hover:bg-primary/10 transition-colors cursor-pointer">Ubah</button>
            )}
          </div>
          {group?.buttonTitle ? (
            <div className="bg-background rounded-xl px-4 py-3 border border-border">
              <p className="text-xs text-muted-foreground mb-1">Judul aktif:</p>
              <p className="font-bold text-foreground text-sm">{group.buttonTitle}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Belum ada judul custom.</p>
          )}
          {editingTitle && (
            <motion.div className="space-y-3" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={'Contoh: "DARURAT - RT03"'} maxLength={60} className="bg-background" />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleSaveTitle} disabled={savingTitle || !newTitle.trim()}>{savingTitle ? "Menyimpan..." : "Simpan"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)} className="flex-1">Batal</Button>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Mute indicator */}
      {group?.muteAlarmSound && (
        <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-4 py-2.5">
          <VolumeX className="size-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Suara alarm anggota lain dimatikan. <button onClick={() => setShowSettings(true)} className="text-primary underline cursor-pointer">Ubah</button></p>
        </div>
      )}

      {/* Escort Mode */}
      {hasActiveEscort ? (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <Navigation className="size-4 text-yellow-400" />
            <h3 className="font-semibold text-sm text-foreground">Escort Mode Sedang Aktif</h3>
          </div>
          <p className="text-xs text-muted-foreground">Kelola (konfirmasi "Aman" / hentikan) lewat widget kecil di bawah layar — tetap muncul di halaman manapun.</p>
        </div>
      ) : showEscortSetup ? (
        <EscortMode
          groupId={groupId}
          members={memberList}
          groupAdminId={adminMember?.userId}
          onStop={() => setShowEscortSetup(false)}
        />
      ) : (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Navigation className="size-4 text-yellow-400" />
            <h3 className="font-semibold text-sm text-foreground">Escort Mode</h3>
          </div>
          <p className="text-xs text-muted-foreground">Aktifkan untuk monitoring ketika bepergian malam. Pilih siapa yang memantau Anda.</p>
          <Button variant="secondary" size="sm" className="w-full gap-2 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10" onClick={() => setShowEscortSetup(true)}>
            <Navigation className="size-4" /> Aktifkan Escort Mode
          </Button>
        </div>
      )}

      {/* Tab: Anggota & Siaran */}
      <div className="space-y-3">
        <div className="flex rounded-xl overflow-hidden border border-border">
          <button onClick={() => setActiveTab("alarm")} className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${activeTab === "alarm" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <Users className="size-3.5" /> Anggota ({members?.length ?? 0})
          </button>
          <button onClick={() => setActiveTab("broadcast")} className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${activeTab === "broadcast" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <Radio className="size-3.5" /> Siaran ({broadcasts?.length ?? 0})
          </button>
        </div>

        {activeTab === "alarm" && (
          <div className="space-y-2">
            {members === undefined ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : (
              members.map((m) => (
                <div key={m.memberId} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.email ?? ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.lastLocation && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="size-3" />
                        {formatDistanceToNow(new Date(m.lastLocation.updatedAt), { addSuffix: true, locale: idLocale })}
                      </div>
                    )}
                    {m.role === "admin" && (
                      <span className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">Admin</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "broadcast" && (
          <div className="space-y-2">
            {broadcasts === undefined ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : broadcasts.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <Radio className="size-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Belum ada siaran untuk grup ini</p>
              </div>
            ) : (
              broadcasts.map((b) => (
                <div key={b._id} className="bg-background border border-border rounded-xl p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                      <Megaphone className="size-3" />{b.senderName ?? "Admin"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(b.sentAt), { addSuffix: true, locale: idLocale })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{b.message}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <button onClick={handleLeave} className="w-full text-sm text-destructive hover:bg-destructive/10 py-3 rounded-xl border border-destructive/20 transition-colors cursor-pointer">
        Keluar dari Grup
      </button>

      {showSettings && adminMember && (
        <AlarmSettingsDialog
          groupId={groupId}
          groupAdminId={adminMember.userId}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// --- Create/Join Group Modals ---
function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ inviteCode: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const createGroup = useMutation(api.groups.createGroup);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await createGroup({ name: name.trim(), description: description.trim() || undefined });
      setResult({ inviteCode: res.inviteCode });
    } catch {
      toast.error("Gagal membuat grup.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!result) return;
    QRCode.toDataURL(JSON.stringify({ type: "group_invite", code: result.inviteCode }), {
      width: 220,
      margin: 2,
      color: { dark: "#ffffff", light: "#1a0a0a" },
    }).then(setQrDataUrl);
  }, [result]);

  const copyCode = () => {
    if (result) { navigator.clipboard.writeText(result.inviteCode); toast.success("Kode undangan disalin!"); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Shield className="size-5 text-primary" /> Buat Grup Keamanan</DialogTitle></DialogHeader>
        {result ? (
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mx-auto"><Shield className="size-8 text-green-400" /></div>
            <p className="font-bold text-foreground">Grup berhasil dibuat!</p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR undangan grup" className="rounded-xl w-48 h-48 mx-auto" />
            ) : (
              <Skeleton className="w-48 h-48 rounded-xl mx-auto" />
            )}
            <p className="text-xs text-muted-foreground">Anggota bisa scan QR ini untuk langsung gabung, atau pakai kode manual:</p>
            <div className="bg-background rounded-xl p-4 flex items-center justify-between">
              <span className="font-mono text-2xl font-black text-primary tracking-widest">{result.inviteCode}</span>
              <button onClick={copyCode} className="p-2 rounded-lg hover:bg-card cursor-pointer"><Copy className="size-4 text-muted-foreground" /></button>
            </div>
            <Button onClick={onClose} className="w-full">Selesai</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={'Contoh: "RT 05 Desa Maju"'} className="bg-background border-border" />
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Deskripsi (opsional)" className="bg-background border-border" />
            <Button onClick={handleCreate} disabled={loading || !name.trim()} className="w-full">{loading ? "Membuat..." : "Buat Grup"}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function JoinGroupModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const joinGroup = useMutation(api.groups.joinGroup);

  const doJoin = async (inviteCode: string) => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    try {
      await joinGroup({ inviteCode: inviteCode.trim() });
      toast.success("Berhasil bergabung ke grup!");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal bergabung.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = () => doJoin(code);

  const handleScan = (data: string) => {
    setShowScanner(false);
    let scannedCode = data.trim();
    try {
      const parsed = JSON.parse(data);
      if (parsed?.type === "group_invite" && typeof parsed.code === "string") {
        scannedCode = parsed.code;
      }
    } catch {
      // bukan JSON — anggap saja isinya langsung kode undangan mentah
    }
    scannedCode = scannedCode.toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(scannedCode)) {
      toast.error("QR tidak berisi kode undangan grup yang valid.");
      return;
    }
    setCode(scannedCode);
    void doJoin(scannedCode); // auto-submit setelah scan sukses
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><LogIn className="size-5 text-primary" /> Gabung Grup</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Masukkan kode undangan 6 karakter dari admin grup, atau scan QR-nya:</p>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} className="bg-background border-border text-center text-xl font-mono tracking-widest font-bold" />
          <Button variant="secondary" className="w-full gap-2" onClick={() => setShowScanner(true)}>
            <QrCode className="size-4" /> Scan QR Undangan
          </Button>
          <Button onClick={handleJoin} disabled={loading || code.length !== 6} className="w-full">{loading ? "Bergabung..." : "Gabung Sekarang"}</Button>
        </div>
      </DialogContent>
      {showScanner && (
        <QRScannerModal
          title="Scan QR Undangan Grup"
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </Dialog>
  );
}

function InviteQRModal({ inviteCode, onClose }: { inviteCode: string; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(JSON.stringify({ type: "group_invite", code: inviteCode }), {
      width: 240,
      margin: 2,
      color: { dark: "#ffffff", light: "#1a0a0a" },
    }).then(setQrDataUrl);
  }, [inviteCode]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader><DialogTitle className="text-center">QR Undangan Grup</DialogTitle></DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR undangan grup" className="rounded-xl w-56 h-56" />
          ) : (
            <Skeleton className="w-56 h-56 rounded-xl" />
          )}
          <p className="font-mono text-xl font-black text-primary tracking-widest">{inviteCode}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Community Inner ---
function CommunityInner() {
  const groups = useQuery(api.groups.getMyGroups, {});
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<Id<"groups"> | null>(null);
  const [activeTab, setActiveTab] = useState<"groups" | "inbox">("groups");
  const [showInviteQR, setShowInviteQR] = useState(false);

  if (groups === undefined) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  }

  if (selectedGroupId) {
    const group = groups.find((g) => g?._id === selectedGroupId);
    return (
      <div>
        {group && (
          <div className="mb-4 bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Shield className="size-5 text-primary" /></div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground">{group.name}</p>
              <p className="text-xs text-muted-foreground">{group.memberCount} anggota · Kode: <span className="font-mono text-primary">{group.inviteCode}</span></p>
            </div>
            <button onClick={() => setShowInviteQR(true)} className="p-2 rounded-lg hover:bg-background cursor-pointer flex-shrink-0">
              <QrCode className="size-5 text-muted-foreground" />
            </button>
          </div>
        )}
        <GroupDetail groupId={selectedGroupId} onBack={() => setSelectedGroupId(null)} />
        {showInviteQR && group && (
          <InviteQRModal inviteCode={group.inviteCode} onClose={() => setShowInviteQR(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex rounded-xl overflow-hidden border border-border">
        <button onClick={() => setActiveTab("groups")} className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${activeTab === "groups" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
          <Shield className="size-3.5" /> Grup Saya
        </button>
        <button onClick={() => setActiveTab("inbox")} className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${activeTab === "inbox" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
          <Megaphone className="size-3.5" /> Kotak Siaran
        </button>
      </div>

      {activeTab === "groups" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => setShowCreate(true)} className="gap-2"><Plus className="size-4" /> Buat Grup</Button>
            <Button variant="secondary" onClick={() => setShowJoin(true)} className="gap-2 border border-border"><LogIn className="size-4" /> Gabung Grup</Button>
          </div>

          {groups.length === 0 ? (
            <div className="text-center py-14 space-y-3">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto"><Users className="size-8 text-muted-foreground" /></div>
              <p className="font-semibold text-foreground">Belum Ada Grup</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">Buat grup keamanan RT/RW atau bergabung dengan kode undangan dari admin.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => group ? (
                <motion.button key={group._id} onClick={() => setSelectedGroupId(group._id)} className="w-full bg-card border border-border rounded-2xl p-4 flex items-center gap-4 hover:border-primary/30 transition-colors cursor-pointer text-left" whileTap={{ scale: 0.98 }}>
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0"><Shield className="size-6 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground truncate">{group.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      <Users className="size-3" /> {group.memberCount} anggota{group.role === "admin" && <span className="text-primary">· Admin</span>}
                    </p>
                    {group.muteAlarmSound && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><VolumeX className="size-3" /> Suara dimatikan</p>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
                </motion.button>
              ) : null)}
            </div>
          )}
        </>
      )}

      {activeTab === "inbox" && <BroadcastInbox />}

      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} />}
      {showJoin && <JoinGroupModal onClose={() => setShowJoin(false)} />}
    </div>
  );
}

export default function CommunityPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer"><ArrowLeft className="size-5 text-foreground" /></button>
        <div>
          <h1 className="font-bold text-foreground flex items-center gap-2"><Users className="size-4 text-primary" /> Komunitas</h1>
          <p className="text-xs text-muted-foreground">Grup keamanan RT/RW</p>
        </div>
      </div>
      <motion.div className="max-w-lg mx-auto px-4 py-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Authenticated><CommunityInner /></Authenticated>
      </motion.div>
    </div>
  );
}
