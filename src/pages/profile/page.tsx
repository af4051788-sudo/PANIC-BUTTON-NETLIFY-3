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
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  if (user && !initialized) {
    setName(user.name ?? "");
    setPhone(user.phone ?? "");
    setEmergencyContact(user.emergencyContact ?? "");
    setEmergencyContactName(user.emergencyContactName ?? "");
    setLocationPrivacy((user.locationPrivacy as "precise" | "area" | "anonymous") ?? "precise");
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
      await updateProfile({ name, phone, emergencyContact, emergencyContactName, locationPrivacy });
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
