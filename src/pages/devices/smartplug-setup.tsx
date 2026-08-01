import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ArrowLeft, Plug, CheckCircle2, Clock, QrCode, Plus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

// Layar 3b — sub-alur "Hubungkan Smart Plug" dari rancangan onboarding.
// Diakses dari halaman Device (bagian "Device Komunal (Admin)").
function SmartPlugSetupCore() {
  const navigate = useNavigate();
  const groups = useQuery(api.groups.getMyGroups);
  const adminGroups = (groups ?? []).filter((g) => g.role === "admin");
  const [selectedGroupId, setSelectedGroupId] = useState<Id<"groups"> | null>(null);
  const effectiveGroupId = selectedGroupId ?? adminGroups[0]?._id ?? null;

  const requests = useQuery(
    api.smartplug.getMyRequests,
    effectiveGroupId ? { groupId: effectiveGroupId } : "skip",
  );
  const requestLink = useMutation(api.smartplug.requestLink);
  const confirmLinked = useMutation(api.smartplug.confirmLinked);
  const registerDevice = useMutation(api.smartplug.registerSmartPlugDevice);

  const [step, setStep] = useState<"checklist" | "form">("checklist");
  const [locationLabel, setLocationLabel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceTuyaId, setNewDeviceTuyaId] = useState("");

  if (groups === undefined) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (adminGroups.length === 0) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center space-y-3">
        <Plug className="size-10 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">Hanya pengurus komunitas yang bisa mengatur smart plug.</p>
      </div>
    );
  }

  // Request paling relevan: yang belum "linked" (masih berjalan), kalau tidak
  // ada tampilkan yang terakhir sebagai referensi + tombol ajukan baru.
  const activeRequest = (requests ?? []).find((r) => r.status === "pending" || r.status === "qr_ready");
  const latestLinked = (requests ?? []).find((r) => r.status === "linked");

  const handleSubmit = async () => {
    if (!locationLabel.trim() || !effectiveGroupId) return;
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1) {
      toast.error("Jumlah smart plug tidak valid.");
      return;
    }
    try {
      await requestLink({ groupId: effectiveGroupId, locationLabel: locationLabel.trim(), quantity: qty });
      toast.success("Permintaan terkirim. Menunggu diproses admin (biasanya < 24 jam).");
      setLocationLabel("");
      setQuantity("1");
      setStep("checklist");
    } catch {
      toast.error("Gagal mengirim permintaan.");
    }
  };

  const handleConfirmLinked = async () => {
    if (!activeRequest) return;
    try {
      await confirmLinked({ requestId: activeRequest._id });
      toast.success("Berhasil dihubungkan! Sekarang beri nama tiap smart plug kamu.");
    } catch {
      toast.error("Gagal konfirmasi. Coba lagi.");
    }
  };

  const handleRegisterDevice = async () => {
    if (!newDeviceName.trim() || !newDeviceTuyaId.trim() || !effectiveGroupId) return;
    try {
      await registerDevice({
        groupId: effectiveGroupId,
        name: newDeviceName.trim(),
        tuyaDeviceId: newDeviceTuyaId.trim(),
      });
      toast.success(`"${newDeviceName}" berhasil didaftarkan.`);
      setNewDeviceName("");
      setNewDeviceTuyaId("");
    } catch {
      toast.error("Gagal mendaftarkan smart plug.");
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-6 pb-24 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/devices")} className="cursor-pointer">
          <ArrowLeft className="size-5 text-muted-foreground" />
        </button>
        <h1 className="font-bold text-foreground">Hubungkan Smart Plug</h1>
      </div>

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

      {requests === undefined ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : activeRequest?.status === "qr_ready" ? (
        // ── QR SIAP — pengurus RT scan pakai app Smart Life ──────────────────
        <div className="bg-card border border-primary/20 rounded-2xl p-5 space-y-4 text-center">
          <QrCode className="size-8 text-primary mx-auto" />
          <p className="font-bold text-foreground">QR siap, scan sekarang</p>
          <QrImage requestId={activeRequest._id} />
          <p className="text-xs text-muted-foreground">
            Buka app <span className="font-medium text-foreground">Smart Life</span> → tab "Saya" → ikon QR di kanan atas → scan gambar ini.
          </p>
          <Button onClick={handleConfirmLinked} className="w-full">Sudah Berhasil Discan</Button>
        </div>
      ) : activeRequest?.status === "pending" ? (
        // ── MENUNGGU DIPROSES ADMIN ──────────────────────────────────────────
        <div className="bg-card border border-border rounded-2xl p-5 space-y-2 text-center">
          <Clock className="size-8 text-amber-400 mx-auto" />
          <p className="font-bold text-foreground">Menunggu diproses</p>
          <p className="text-xs text-muted-foreground">
            Permintaan untuk "{activeRequest.locationLabel}" sedang diproses admin. Biasanya kurang dari 24 jam — kamu akan dapat notifikasi begitu QR siap.
          </p>
        </div>
      ) : step === "checklist" ? (
        // ── EDUKASI SINGKAT SEBELUM AJUKAN ───────────────────────────────────
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <p className="font-bold text-foreground">Sebelum lanjut, pastikan sudah:</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Beli smart plug (merek apapun, asal support app Smart Life)</li>
            <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Pasang & colokkan ke listrik seperti biasa</li>
            <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Install app Smart Life, buat akun sendiri, pairing smart plug ke akun itu</li>
          </ul>
          <Button onClick={() => setStep("form")} className="w-full">Sudah, Lanjut</Button>
          {latestLinked && (
            <p className="text-xs text-center text-muted-foreground">
              Sebelumnya sudah terhubung: "{latestLinked.locationLabel}". Ini untuk menambah lokasi baru.
            </p>
          )}
        </div>
      ) : (
        // ── FORM PENGAJUAN ────────────────────────────────────────────────────
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nama lokasi</label>
            <Input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder='mis. "Pos Ronda Blok A"' />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Jumlah smart plug</label>
            <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <Button onClick={handleSubmit} className="w-full">Ajukan Penghubungan</Button>
        </div>
      )}

      {/* Setelah linked: daftarkan tiap smart plug dengan nama sendiri */}
      {latestLinked && (
        <div className="bg-card border border-primary/20 rounded-2xl p-5 space-y-3">
          <p className="font-bold text-sm text-foreground">Daftarkan smart plug "{latestLinked.locationLabel}"</p>
          <p className="text-xs text-muted-foreground">Beri nama tiap smart plug supaya mudah dikenali (mis. "Sirine Pos Ronda").</p>
          <Input value={newDeviceName} onChange={(e) => setNewDeviceName(e.target.value)} placeholder="Nama smart plug" />
          <Input value={newDeviceTuyaId} onChange={(e) => setNewDeviceTuyaId(e.target.value)} placeholder="ID Device Tuya (dari app Smart Life)" />
          <Button onClick={handleRegisterDevice} variant="secondary" className="w-full gap-1">
            <Plus className="size-4" /> Tambah
          </Button>
        </div>
      )}
    </div>
  );
}

function QrImage({ requestId }: { requestId: Id<"smartPlugLinkRequests"> }) {
  const url = useQuery(api.smartplug.getQrImageUrl, { requestId });
  if (url === undefined) return <Skeleton className="h-48 w-48 mx-auto rounded-xl" />;
  if (!url) return <p className="text-xs text-muted-foreground">Gambar QR belum tersedia.</p>;
  return <img src={url} alt="QR code untuk menghubungkan akun Smart Life" className="w-48 h-48 mx-auto rounded-xl border border-border" />;
}

export default function SmartPlugSetupPage() {
  return (
    <Authenticated>
      <SmartPlugSetupCore />
    </Authenticated>
  );
}
