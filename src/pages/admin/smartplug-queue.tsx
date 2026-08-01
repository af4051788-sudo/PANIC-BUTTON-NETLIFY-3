import { useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ArrowLeft, Plug, Upload, Clock, QrCode, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

function SmartPlugQueueCore() {
  const navigate = useNavigate();
  const requests = useQuery(api.smartplug.getPendingRequests);
  const generateQrUploadUrl = useMutation(api.smartplug.generateQrUploadUrl);
  const markQrReady = useMutation(api.smartplug.markQrReady);
  const rejectRequest = useMutation(api.smartplug.rejectRequest);
  const [processingId, setProcessingId] = useState<Id<"smartPlugLinkRequests"> | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (requests === undefined) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  const handleFileSelected = async (requestId: Id<"smartPlugLinkRequests">, file: File) => {
    setUploading(true);
    try {
      const uploadUrl = await generateQrUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await result.json();
      await markQrReady({ requestId, qrImageStorageId: storageId });
      toast.success("QR berhasil diupload, notifikasi terkirim ke pengurus RT.");
      setProcessingId(null);
    } catch {
      toast.error("Gagal upload QR. Coba lagi.");
    } finally {
      setUploading(false);
    }
  };

  const handleReject = async (requestId: Id<"smartPlugLinkRequests">) => {
    try {
      await rejectRequest({ requestId, note: "Data tidak lengkap, silakan ajukan ulang." });
      toast.success("Permintaan ditolak.");
    } catch {
      toast.error("Gagal menolak permintaan.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/admin")} className="cursor-pointer">
          <ArrowLeft className="size-5 text-muted-foreground" />
        </button>
        <h1 className="font-bold text-foreground flex items-center gap-2">
          <Plug className="size-4 text-primary" /> Antrian Penghubungan Smart Plug
        </h1>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          Tidak ada permintaan yang menunggu diproses.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r._id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-sm text-foreground">{r.groupName}</p>
                  <p className="text-xs text-muted-foreground">{r.locationLabel} · {r.quantity} smart plug</p>
                </div>
                {r.status === "pending" ? (
                  <span className="flex items-center gap-1 text-xs text-amber-400 shrink-0">
                    <Clock className="size-3.5" /> Pending
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-primary shrink-0">
                    <QrCode className="size-3.5" /> QR terkirim
                  </span>
                )}
              </div>

              {r.status === "pending" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 gap-1"
                    disabled={uploading}
                    onClick={() => {
                      setProcessingId(r._id);
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="size-3.5" /> {uploading && processingId === r._id ? "Mengupload..." : "Upload QR"}
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" onClick={() => handleReject(r._id)}>
                    <X className="size-3.5" /> Tolak
                  </Button>
                </div>
              )}

              {r.status === "qr_ready" && (
                <p className="text-xs text-muted-foreground">Menunggu pengurus RT scan QR untuk menyelesaikan.</p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground pt-2">
        Cara generate QR: buka dashboard Tuya IoT Platform → Cloud Project kamu → Devices → "Link Tuya App Account" → Add App Account → screenshot QR yang muncul → upload di sini.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && processingId) handleFileSelected(processingId, file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export default function SmartPlugQueuePage() {
  return (
    <Authenticated>
      <SmartPlugQueueCore />
    </Authenticated>
  );
}
