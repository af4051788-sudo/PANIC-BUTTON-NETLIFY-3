import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  ArrowLeft,
  Plus,
  Wifi,
  WifiOff,
  Trash2,
  RefreshCw,
  QrCode,
  Cpu,
  Clock,
  Battery,
  Signal,
  Code2,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { QRScannerModal } from "@/components/qr-scanner.tsx";

type DeviceDoc = {
  _id: Id<"devices">;
  deviceId: string;
  name: string;
  pairingCode: string;
  isOnline: boolean;
  lastHeartbeat?: string;
  wifiStrength?: number;
  batteryLevel?: number;
};

function QRModal({ device, onClose }: { device: DeviceDoc; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const pairingPayload = JSON.stringify({
    deviceId: device.deviceId,
    pairingCode: device.pairingCode,
  });

  useEffect(() => {
    QRCode.toDataURL(pairingPayload, {
      width: 280,
      margin: 2,
      color: { dark: "#ffffff", light: "#1a0a0a" },
    }).then(setQrDataUrl);
  }, [pairingPayload]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Scan QR untuk Pairing</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" className="rounded-xl w-64 h-64" />
          ) : (
            <Skeleton className="w-64 h-64 rounded-xl" />
          )}
          <div className="w-full bg-background rounded-xl p-4 space-y-2">
            <p className="text-xs text-muted-foreground text-center mb-3">
              Atau masukkan kode ini secara manual ke firmware Wemos D1:
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Device ID</p>
                <p className="font-mono font-bold text-foreground">{device.deviceId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pairing Code</p>
                <p className="font-mono font-bold text-primary text-lg">{device.pairingCode}</p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeviceCard({
  device,
  onShowQR,
  onDelete,
  onRegenCode,
}: {
  device: DeviceDoc;
  onShowQR: (d: DeviceDoc) => void;
  onDelete: (id: Id<"devices">) => void;
  onRegenCode: (id: Id<"devices">) => void;
}) {
  const lastSeen = device.lastHeartbeat
    ? formatDistanceToNow(new Date(device.lastHeartbeat), { addSuffix: true, locale: idLocale })
    : null;

  return (
    <motion.div
      className="bg-card border border-border rounded-2xl p-4 space-y-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${device.isOnline ? "bg-green-500/10 border border-green-500/30" : "bg-muted border border-border"}`}>
            <Cpu className={`size-5 ${device.isOnline ? "text-green-400" : "text-muted-foreground"}`} />
          </div>
          <div>
            <p className="font-bold text-foreground text-sm">{device.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{device.deviceId}</p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${device.isOnline ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-muted text-muted-foreground border border-border"}`}>
          {device.isOnline ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {device.isOnline ? "Online" : "Offline"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-background rounded-lg p-2 text-center">
          <Clock className="size-3 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground truncate">{lastSeen ?? "Belum pernah"}</p>
        </div>
        {device.wifiStrength !== undefined && (
          <div className="bg-background rounded-lg p-2 text-center">
            <Signal className="size-3 text-muted-foreground mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">{device.wifiStrength} dBm</p>
          </div>
        )}
        {device.batteryLevel !== undefined && (
          <div className="bg-background rounded-lg p-2 text-center">
            <Battery className="size-3 text-muted-foreground mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">{device.batteryLevel}%</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between bg-background rounded-lg px-3 py-2">
        <div>
          <p className="text-xs text-muted-foreground">Kode Pairing</p>
          <p className="font-mono font-bold text-primary tracking-widest">{device.pairingCode}</p>
        </div>
        <button
          onClick={() => onRegenCode(device._id)}
          className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1 gap-2" onClick={() => onShowQR(device)}>
          <QrCode className="size-4" /> QR Code
        </Button>
        <button
          onClick={() => onDelete(device._id)}
          className="px-3 py-2 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors cursor-pointer text-sm flex items-center gap-1.5"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}

function DevicesList() {
  const navigate = useNavigate();
  const devices = useQuery(api.devices.getMyDevices, {});
  const createDevice = useMutation(api.devices.createDevice);
  const deleteDevice = useMutation(api.devices.deleteDevice);
  const regenCode = useMutation(api.devices.regeneratePairingCode);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedQR, setSelectedQR] = useState<DeviceDoc | null>(null);

  if (devices === undefined) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await createDevice({ name: newName.trim() });
      toast.success(`Perangkat "${newName}" berhasil ditambahkan.`);
      setNewName("");
      setShowAdd(false);
    } catch {
      toast.error("Gagal menambahkan perangkat.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: Id<"devices">) => {
    try {
      await deleteDevice({ deviceId: id });
      toast.success("Perangkat dihapus.");
    } catch {
      toast.error("Gagal menghapus perangkat.");
    }
  };

  const handleRegen = async (id: Id<"devices">) => {
    try {
      await regenCode({ deviceId: id });
      toast.success("Kode pairing diperbarui.");
    } catch {
      toast.error("Gagal memperbarui kode.");
    }
  };

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {showAdd && (
          <motion.div
            className="bg-card border border-primary/30 rounded-2xl p-4 space-y-3"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <p className="font-bold text-sm text-foreground">Tambah Perangkat Wemos D1</p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={'Contoh: "Pos Ronda RT 03"'}
              className="bg-background border-border"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={adding || !newName.trim()} className="flex-1">
                {adding ? "Menambahkan..." : "Tambahkan"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Batal</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {devices.length === 0 && !showAdd ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Cpu className="size-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">Belum ada perangkat Wemos D1 terpasang.</p>
        </div>
      ) : (
        devices.map((device) => (
          <DeviceCard
            key={device._id}
            device={device as DeviceDoc}
            onShowQR={setSelectedQR}
            onDelete={handleDelete}
            onRegenCode={handleRegen}
          />
        ))
      )}

      {!showAdd && (
        <Button variant="secondary" className="w-full gap-2 border border-dashed border-border" onClick={() => setShowAdd(true)}>
          <Plus className="size-4" /> Tambah Perangkat Wemos D1
        </Button>
      )}

      <button
        onClick={() => navigate("/firmware")}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <Code2 className="size-4 text-primary" />
          <div className="text-left">
            <p className="text-sm font-bold text-primary">Firmware Wemos D1</p>
            <p className="text-xs text-muted-foreground">Kode Arduino + skema rangkaian + panduan</p>
          </div>
        </div>
        <ArrowLeft className="size-4 text-primary rotate-180" />
      </button>

      {selectedQR && <QRModal device={selectedQR} onClose={() => setSelectedQR(null)} />}
    </div>
  );
}

// ── Fase 5: checklist reusable untuk memilih device target ──────────────────
function DeviceTargetChecklist({
  availableDevices,
  selectedIds,
  onToggle,
}: {
  availableDevices: Array<{ id: string; name: string; deviceType: string; groupName?: string; isOnline: boolean }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (availableDevices.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Belum ada device yang bisa dipilih.</p>;
  }
  return (
    <div className="space-y-2">
      {availableDevices.map((d) => (
        <label key={d.id} className="flex items-center gap-3 bg-background rounded-lg px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={selectedIds.includes(d.id)}
            onChange={() => onToggle(d.id)}
            className="size-4 accent-primary"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {d.deviceType === "community" ? `Komunal${d.groupName ? " · " + d.groupName : ""}` : "Pribadi"}
            </p>
          </div>
          <span className={`size-2 rounded-full flex-shrink-0 ${d.isOnline ? "bg-green-400" : "bg-muted-foreground/40"}`} />
        </label>
      ))}
    </div>
  );
}

// ── Fase 5: pengaturan target alarm milik SAYA (dipakai tiap kali panic ditekan) ─
function AlarmTargetSettings() {
  const [category, setCategory] = useState<"panic_silent" | "escort">("panic_silent");
  const data = useQuery(api.alarmTargets.getMyAlarmTargets, { category });
  const setTargets = useMutation(api.alarmTargets.setMyAlarmTargets);
  const resetTargets = useMutation(api.alarmTargets.resetMyAlarmTargetsToDefault);
  const [pending, setPending] = useState<string[] | null>(null);

  useEffect(() => {
    setPending(null);
  }, [category]);

  if (data === undefined) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }

  const selected = pending ?? data.selectedDeviceIds;

  const toggle = (id: string) => {
    setPending((selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]));
  };

  const handleSave = async () => {
    if (pending === null) return;
    try {
      await setTargets({ category, targetDeviceIds: pending as Id<"devices">[] });
      toast.success("Target alarm disimpan.");
      setPending(null);
    } catch {
      toast.error("Gagal menyimpan target alarm.");
    }
  };

  const handleReset = async () => {
    try {
      await resetTargets({ category });
      toast.success("Dikembalikan ke default.");
      setPending(null);
    } catch {
      toast.error("Gagal reset ke default.");
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div>
        <p className="font-bold text-sm text-foreground">Target Alarm</p>
        <p className="text-xs text-muted-foreground">
          Device mana saja yang ikut bunyi setiap kali kamu menekan panic button — diatur sekali di sini, tidak perlu pilih lagi tiap darurat.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setCategory("panic_silent")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${category === "panic_silent" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border border-border"}`}
        >
          Panic / Silent
        </button>
        <button
          onClick={() => setCategory("escort")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${category === "escort" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border border-border"}`}
        >
          Mode Kawal
        </button>
      </div>

      {!data.isCustomized && pending === null && (
        <p className="text-xs text-muted-foreground italic">
          {category === "panic_silent"
            ? "Default: semua device (pribadi + komunal grup kamu) ikut bunyi."
            : "Default: tidak ada device yang bunyi — hanya notifikasi antar-app (cocok untuk jalan pulang malam tanpa geger satu RT)."}
        </p>
      )}

      <DeviceTargetChecklist availableDevices={data.availableDevices} selectedIds={selected} onToggle={toggle} />

      {pending !== null ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1" onClick={handleSave}>Simpan</Button>
          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Batal</Button>
        </div>
      ) : (
        data.isCustomized && (
          <Button size="sm" variant="secondary" className="w-full" onClick={handleReset}>
            Kembalikan ke Default
          </Button>
        )
      )}
    </div>
  );
}

// ── Fase 5: manajemen device komunal (Pos Satpam/Kantor RT/RW/Fasum) — admin grup saja ─
function CommunityDeviceTargetEditor({ deviceId }: { deviceId: Id<"devices"> }) {
  const data = useQuery(api.alarmTargets.getCommunityDeviceTargets, { deviceId });
  const setTargets = useMutation(api.alarmTargets.setCommunityDeviceTargets);
  const [pending, setPending] = useState<string[] | null>(null);

  if (data === undefined) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (data === null) return null;

  const selected = pending ?? data.selectedDeviceIds;
  const toggle = (id: string) => setPending(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="bg-background rounded-xl p-3 space-y-2 mt-2">
      <p className="text-xs font-bold text-foreground">Device yang ikut bunyi kalau lokasi ini ditekan:</p>
      <DeviceTargetChecklist availableDevices={data.availableDevices} selectedIds={selected} onToggle={toggle} />
      {pending !== null && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1"
            onClick={async () => {
              await setTargets({ deviceId, targetDeviceIds: pending as Id<"devices">[] });
              toast.success("Target disimpan.");
              setPending(null);
            }}
          >
            Simpan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Batal</Button>
        </div>
      )}
    </div>
  );
}

function CommunityDeviceManager() {
  const navigate = useNavigate();
  const groups = useQuery(api.groups.getMyGroups, {});
  const adminGroups = (groups ?? []).filter((g) => g.role === "admin");
  const [selectedGroupId, setSelectedGroupId] = useState<Id<"groups"> | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  const [selectedQR, setSelectedQR] = useState<DeviceDoc | null>(null);

  const effectiveGroupId = selectedGroupId ?? adminGroups[0]?._id ?? null;

  const communityDevices = useQuery(
    api.communityDevices.getGroupCommunityDevices,
    effectiveGroupId ? { groupId: effectiveGroupId } : "skip",
  );
  const registerDevice = useMutation(api.communityDevices.registerCommunityDevice);
  const removeDevice = useMutation(api.communityDevices.removeCommunityDevice);
  const regenCode = useMutation(api.communityDevices.regenerateCommunityPairingCode);

  if (groups === undefined) return <Skeleton className="h-32 w-full rounded-2xl" />;
  if (adminGroups.length === 0) return null; // hanya admin grup yang lihat bagian ini

  const handleAdd = async () => {
    if (!newLabel.trim() || !effectiveGroupId) return;
    try {
      await registerDevice({ groupId: effectiveGroupId, locationLabel: newLabel.trim() });
      toast.success(`Device lokasi "${newLabel}" berhasil didaftarkan.`);
      setNewLabel("");
      setShowAdd(false);
    } catch {
      toast.error("Gagal mendaftarkan device.");
    }
  };

  return (
    <div className="bg-card border border-primary/20 rounded-2xl p-4 space-y-3">
      <div>
        <p className="font-bold text-sm text-foreground">Device Komunal (Admin)</p>
        <p className="text-xs text-muted-foreground">
          Wemos untuk lokasi bersama — Pos Satpam, Kantor RT/RW, Fasum. Tombol fisiknya memicu alarm atas nama lokasi, bukan atas nama orang.
        </p>
      </div>

      <Button variant="outline" size="sm" className="w-full" onClick={() => navigate("/devices/smartplug-setup")}>
        Pengaturan Perangkat Tuya
      </Button>

      {adminGroups.length > 1 && (
        <select
          value={effectiveGroupId ?? ""}
          onChange={(e) => setSelectedGroupId(e.target.value as Id<"groups">)}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          {adminGroups.map((g) => (
            <option key={g._id} value={g._id}>{g.name}</option>
          ))}
        </select>
      )}

      {communityDevices === undefined ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : (
        <div className="space-y-2">
          {communityDevices.map((d) => (
            <div key={d._id} className="bg-background rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${d.isOnline ? "bg-green-500/10 border border-green-500/30" : "bg-muted border border-border"}`}>
                    <Cpu className={`size-4 ${d.isOnline ? "text-green-400" : "text-muted-foreground"}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{d.locationLabel ?? d.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{d.deviceId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setSelectedQR(d as DeviceDoc)} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground cursor-pointer">
                    <QrCode className="size-4" />
                  </button>
                  <button onClick={() => regenCode({ deviceId: d._id })} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground cursor-pointer">
                    <RefreshCw className="size-4" />
                  </button>
                  <button
                    onClick={async () => {
                      await removeDevice({ deviceId: d._id });
                      toast.success("Device dihapus.");
                    }}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive cursor-pointer"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <button
                onClick={() => setExpandedDeviceId(expandedDeviceId === d._id ? null : d._id)}
                className="text-[11px] font-bold text-primary mt-2 cursor-pointer"
              >
                {expandedDeviceId === d._id ? "Tutup pengaturan target ▲" : "Atur target alarm lokasi ini ▼"}
              </button>
              {expandedDeviceId === d._id && <CommunityDeviceTargetEditor deviceId={d._id} />}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <motion.div
            className="bg-background border border-primary/30 rounded-xl p-3 space-y-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder='Contoh: "Pos Satpam Blok A"'
              className="bg-card border-border"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!newLabel.trim()} className="flex-1">Daftarkan</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Batal</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showAdd && (
        <Button variant="secondary" className="w-full gap-2 border border-dashed border-border" onClick={() => setShowAdd(true)}>
          <Plus className="size-4" /> Daftarkan Device Lokasi Baru
        </Button>
      )}

      {selectedQR && <QRModal device={selectedQR} onClose={() => setSelectedQR(null)} />}
    </div>
  );
}

function DeviceQRScanResultModal({
  data,
  onClose,
}: {
  data: { deviceId: string; pairingCode: string };
  onClose: () => void;
}) {
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} disalin!`);
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader><DialogTitle>Hasil Scan QR Device</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="bg-background rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Device ID</p>
              <p className="font-mono font-bold text-foreground">{data.deviceId}</p>
            </div>
            <button onClick={() => copy(data.deviceId, "Device ID")} className="p-2 rounded-lg hover:bg-card cursor-pointer">
              <Code2 className="size-4 text-muted-foreground" />
            </button>
          </div>
          <div className="bg-background rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Pairing Code</p>
              <p className="font-mono font-bold text-primary text-lg">{data.pairingCode}</p>
            </div>
            <button onClick={() => copy(data.pairingCode, "Pairing code")} className="p-2 rounded-lg hover:bg-card cursor-pointer">
              <Code2 className="size-4 text-muted-foreground" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tinggal salin dua nilai ini ke kode firmware Arduino (DEVICE_ID & PAIRING_CODE) di halaman Firmware.
          </p>
          <Button onClick={onClose} className="w-full">Selesai</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DevicesPage() {
  const navigate = useNavigate();
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<{ deviceId: string; pairingCode: string } | null>(null);

  const handleScan = (raw: string) => {
    setShowScanner(false);
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.deviceId === "string" && typeof parsed?.pairingCode === "string") {
        setScanResult({ deviceId: parsed.deviceId, pairingCode: parsed.pairingCode });
        return;
      }
    } catch {
      // bukan format QR device yang dikenal
    }
    toast.error("QR ini bukan QR pairing device yang valid.");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/profile")} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer">
          <ArrowLeft className="size-5 text-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-foreground">Perangkat Wemos D1</h1>
          <p className="text-xs text-muted-foreground">Kelola alarm fisik IoT</p>
        </div>
        <button onClick={() => setShowScanner(true)} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer" title="Scan QR Device">
          <QrCode className="size-5 text-foreground" />
        </button>
      </div>
      <motion.div className="max-w-md mx-auto px-4 py-6 space-y-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Authenticated>
          <DevicesList />
          <AlarmTargetSettings />
          <CommunityDeviceManager />
        </Authenticated>
      </motion.div>
      {showScanner && (
        <QRScannerModal title="Scan QR Device" onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}
      {scanResult && <DeviceQRScanResultModal data={scanResult} onClose={() => setScanResult(null)} />}
    </div>
  );
}
