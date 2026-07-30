import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { usePushNotifications } from "@/hooks/use-push-notifications.ts";
import {
  ArrowLeft,
  User,
  Phone,
  Shield,
  MapPin,
  LogOut,
  ChevronRight,
  Smartphone,
  BellRing,
  Camera,
} from "lucide-react";

function ProfileForm() {
  const user = useQuery(api.users.getCurrentUser, {});
  const pushStatus = useQuery(api.push.getMyPushStatus, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const { getState, isSubscribing, subscribe, unsubscribe } = usePushNotifications();

  const handleTogglePush = async (checked: boolean) => {
    if (checked) {
      const state = getState();
      if (state === "unsupported") {
        toast.error("Perangkat/browser ini tidak mendukung notifikasi push.");
        return;
      }
      if (state === "denied") {
        toast.error("Izin notifikasi diblokir. Aktifkan lewat pengaturan browser.");
        return;
      }
      const ok = await subscribe();
      if (ok) toast.success("Notifikasi darurat diaktifkan di perangkat ini.");
      else toast.error("Gagal mengaktifkan notifikasi.");
    } else {
      await unsubscribe();
      toast.success("Notifikasi dimatikan di perangkat ini.");
    }
  };

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [locationPrivacy, setLocationPrivacy] = useState<"precise" | "area" | "anonymous">("precise");
  const [evidenceEnabled, setEvidenceEnabled] = useState(false);
  const [evidenceTypes, setEvidenceTypes] = useState<Array<"photo" | "audio" | "video">>([]);
  const [evidenceDuration, setEvidenceDuration] = useState(20);
  const [panicHoldDuration, setPanicHoldDuration] = useState(3);
  const [panicRateLimiterEnabled, setPanicRateLimiterEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  if (user && !initialized) {
    setName(user.name ?? "");
    setPhone(user.phone ?? "");
    setEmergencyContact(user.emergencyContact ?? "");
    setEmergencyContactName(user.emergencyContactName ?? "");
    setLocationPrivacy((user.locationPrivacy as "precise" | "area" | "anonymous") ?? "precise");
    setEvidenceEnabled(user.evidenceCaptureEnabled ?? false);
    setEvidenceTypes(user.evidenceCaptureTypes ?? []);
    setEvidenceDuration(user.evidenceCaptureDurationSec ?? 20);
    setPanicHoldDuration(user.panicHoldDurationSec ?? 3);
    setPanicRateLimiterEnabled(user.panicRateLimiterEnabled ?? true);
    setInitialized(true);
  }

  if (user === undefined) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({
        name,
        phone,
        emergencyContact,
        emergencyContactName,
        locationPrivacy,
        evidenceCaptureEnabled: evidenceEnabled,
        evidenceCaptureTypes: evidenceTypes,
        evidenceCaptureDurationSec: evidenceDuration,
        panicHoldDurationSec: panicHoldDuration,
        panicRateLimiterEnabled,
      });
      toast.success("Profil berhasil disimpan.");
    } catch {
      toast.error("Gagal menyimpan profil.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
          <User className="size-9 text-primary" />
        </div>
        <div className="text-center">
          <p className="font-bold text-foreground">{user?.name ?? "Pengguna"}</p>
          <p className="text-sm text-muted-foreground">{user?.email ?? ""}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="flex items-center gap-2 text-muted-foreground">
            <User className="size-4" /> Nama Lengkap
          </Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Budi Santoso" className="bg-card border-border" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone" className="flex items-center gap-2 text-muted-foreground">
            <Phone className="size-4" /> Nomor HP
          </Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08123456789" className="bg-card border-border" />
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <p className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <Shield className="size-3.5" /> Kontak Darurat
          </p>
          <Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} placeholder="Nama kontak darurat" className="bg-card border-border" />
          <Input value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} placeholder="Nomor HP kontak darurat" className="bg-card border-border" />
          <p className="text-xs text-muted-foreground">{"Akan dihubungi otomatis jika alarm aktif > 15 detik."}</p>
        </div>

        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <BellRing className="size-4" /> Notifikasi Alarm Grup
            </Label>
            <Switch
              checked={!!pushStatus?.subscribed}
              disabled={isSubscribing || pushStatus === undefined}
              onCheckedChange={(checked) => void handleTogglePush(checked)}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {"Dapatkan notifikasi walau aplikasi tertutup, saat anggota grup lain menekan tombol darurat."}
          </p>
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <Label className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="size-4" /> Privasi Lokasi
          </Label>
          <Select value={locationPrivacy} onValueChange={(v) => setLocationPrivacy(v as "precise" | "area" | "anonymous")}>
            <SelectTrigger className="bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="precise">Presisi (GPS penuh)</SelectItem>
              <SelectItem value="area">Area (Kecamatan/Kelurahan)</SelectItem>
              <SelectItem value="anonymous">Anonim (Koordinat samar)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <Camera className="size-4" /> Bukti Otomatis Saat Panic
            </Label>
            <Switch checked={evidenceEnabled} onCheckedChange={setEvidenceEnabled} />
          </div>
          <p className="text-xs text-muted-foreground">
            Ambil bukti otomatis saat kamu menekan tombol panic. Browser akan
            meminta izin kamera/mikrofon secara terpisah — kamu tetap bisa menolaknya kapan saja.
          </p>

          {evidenceEnabled && (
            <div className="space-y-3 pt-1">
              <div className="flex gap-2">
                {(["photo", "audio", "video"] as const).map((t) => {
                  const active = evidenceTypes.includes(t);
                  const label = t === "photo" ? "Foto" : t === "audio" ? "Audio" : "Video";
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setEvidenceTypes((prev) =>
                          active ? prev.filter((x) => x !== t) : [...prev, t],
                        )
                      }
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground border border-border"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {evidenceTypes.includes("photo") && (
                <p className="text-[10px] text-muted-foreground bg-background rounded-lg px-2.5 py-2">
                  📸 <b>Foto:</b> otomatis 3 kali jepret, jeda 5 detik antar jepretan — supaya lebih besar peluang dapat gambar yang jelas.
                </p>
              )}

              {evidenceTypes.some((t) => t === "audio" || t === "video") && (
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Durasi rekam</Label>
                  <input
                    type="range"
                    min={10}
                    max={30}
                    step={1}
                    value={evidenceDuration}
                    onChange={(e) => setEvidenceDuration(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-xs font-bold text-foreground w-10 text-right">{evidenceDuration}s</span>
                </div>
              )}
              {evidenceTypes.includes("audio") && (
                <p className="text-[10px] text-muted-foreground bg-background rounded-lg px-2.5 py-2">
                  🎙️ <b>Audio:</b> satu rekaman utuh (bukan terputus-putus) — supaya percakapan/suara di sekitar tetap punya konteks yang jelas.
                </p>
              )}
              {evidenceTypes.includes("video") && (
                <p className="text-[10px] text-muted-foreground bg-background rounded-lg px-2.5 py-2">
                  🎥 <b>Video:</b> satu rekaman utuh, dibatasi maks 20 detik (video lebih berat untuk baterai/kuota — durasi ini dipangkas otomatis kalau slider di atas 20 detik).
                </p>
              )}

              <p className="text-[10px] text-muted-foreground italic">
                ⚠️ Kamera/mikrofon butuh izin eksplisit tiap browser/perangkat, dan otomatis dimatikan setelah selesai — bukan rekaman berkelanjutan.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <Label className="flex items-center gap-2 text-muted-foreground">
            <Shield className="size-4" /> Durasi Tekan-Tahan Tombol Panic
          </Label>
          <p className="text-xs text-muted-foreground">
            Proteksi salah pencet — tombol baru mengirim sinyal setelah ditekan-tahan selama durasi ini.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={panicHoldDuration}
              onChange={(e) => setPanicHoldDuration(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="text-xs font-bold text-foreground w-10 text-right">{panicHoldDuration}s</span>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <Shield className="size-4" /> Batas Penekanan Alarm (Rate Limiter)
            </Label>
            <Switch checked={panicRateLimiterEnabled} onCheckedChange={setPanicRateLimiterEnabled} />
          </div>
          <p className="text-xs text-muted-foreground">
            {panicRateLimiterEnabled
              ? "Aktif (disarankan) — mencegah penyalahgunaan otomatis/bot. Penekanan asli oleh manusia tetap diberi jatah longgar dan tidak akan diblokir."
              : "⚠️ Nonaktif — tombol panic TIDAK akan pernah dibatasi sistem, sekalipun ditekan berkali-kali beruntun. Matikan hanya jika kamu memahami risikonya."}
          </p>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full font-bold">
        {saving ? "Menyimpan..." : "Simpan Profil"}
      </Button>

      <div className="border-t border-border pt-4 space-y-1">
        <button
          onClick={() => navigate("/devices")}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-card transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <Smartphone className="size-4 text-muted-foreground" />
            <span className="text-sm text-foreground">Perangkat Wemos D1</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </div>

      <button
        onClick={() => void signOut()}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer border border-destructive/20"
      >
        <LogOut className="size-4" />
        Keluar
      </button>
    </div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="p-2 rounded-lg hover:bg-card transition-colors cursor-pointer">
          <ArrowLeft className="size-5 text-foreground" />
        </button>
        <h1 className="font-bold text-foreground">Profil {"&"} Pengaturan</h1>
      </div>

      <motion.div
        className="max-w-md mx-auto px-4 py-6"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Authenticated>
          <ProfileForm />
        </Authenticated>
        <Unauthenticated>
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-muted-foreground">Silakan masuk untuk mengatur profil.</p>
            <SignInButton />
          </div>
        </Unauthenticated>
      </motion.div>
    </div>
  );
}
