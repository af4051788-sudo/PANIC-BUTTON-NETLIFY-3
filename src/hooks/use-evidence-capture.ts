import { useCallback } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

export type EvidenceType = "photo" | "audio" | "video";

/**
 * Captures short evidence clips when a panic alarm is triggered — ONLY when
 * the user has explicitly opted in via Profile settings. The browser's own
 * getUserMedia permission prompt is a hard requirement we cannot and should
 * not bypass; this hook simply orchestrates capture + upload once granted.
 *
 * Design (per user request + our recommendation):
 *  - PHOTO: burst of 3 shots, ~5s apart (within the requested 3-7s range).
 *    A single frame can be blurry/mistimed; 3 shots taken a few seconds
 *    apart greatly improve the odds of capturing something useful, at very
 *    low storage/battery cost per shot.
 *  - AUDIO: ONE continuous recording (recommended ~20s). Audio is only
 *    useful with continuity — voices, arguments, background sound need an
 *    unbroken clip to make sense; splitting it into 3 short fragments would
 *    lose exactly the context that makes audio evidence valuable.
 *  - VIDEO: ONE continuous recording (recommended ~12s). Same continuity
 *    argument as audio, kept shorter than audio because video is far more
 *    expensive in storage/battery/bandwidth — 12s is enough to establish
 *    what's happening without draining the phone during an emergency.
 *
 * Every capture stops its media tracks immediately after finishing — this
 * is a short evidence snippet, never a standing recording.
 */
export function useEvidenceCapture() {
  const generateUploadUrl = useMutation(api.evidence.generateEvidenceUploadUrl);
  const attachEvidence = useMutation(api.evidence.attachEvidenceToAlarm);

  const uploadBlob = useCallback(
    async (alarmId: Id<"alarms">, type: EvidenceType, blob: Blob) => {
      try {
        const uploadUrl = await generateUploadUrl({});
        // Convex storage upload endpoint menolak Content-Type yang membawa
        // parameter tambahan (mis. "video/webm;codecs=vp8,opus") — ambil
        // base type-nya saja sebelum dikirim sebagai header.
        const baseContentType = (blob.type || "application/octet-stream").split(";")[0].trim();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": baseContentType },
          body: blob,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.warn(`Upload bukti (${type}) gagal:`, res.status, detail);
          toast.warning(`Gagal mengunggah bukti ${type} (HTTP ${res.status}).`, { duration: Infinity });
          return;
        }
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await attachEvidence({ alarmId, storageId, type });
      } catch (err) {
        console.warn("Gagal upload bukti:", err);
        toast.warning(
          `Gagal mengunggah bukti ${type}${err instanceof Error ? `: ${err.message}` : ""}`,
          { duration: Infinity },
        );
      }
    },
    [generateUploadUrl, attachEvidence],
  );

  /**
   * Opens the camera ONCE and takes `shots` photos spaced `intervalSec`
   * apart, uploading each as soon as it's captured. Reusing one stream
   * across all shots means only a single permission prompt / camera
   * activation instead of one per photo.
   */
  const capturePhotoBurst = useCallback(
    async (alarmId: Id<"alarms">, shots: number, intervalSec: number) => {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = document.createElement("video");
        video.srcObject = stream;
        await video.play();
        await new Promise((r) => setTimeout(r, 350)); // waktu auto-exposure kamera menyesuaikan

        const canvas = document.createElement("canvas");
        for (let shot = 0; shot < shots; shot++) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob: Blob | null = await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
          );
          if (blob) void uploadBlob(alarmId, "photo", blob);
          if (shot < shots - 1) await new Promise((r) => setTimeout(r, intervalSec * 1000));
        }
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        const message =
          name === "NotAllowedError"
            ? "Izin kamera diblokir. Cek pengaturan izin situs ini di browser."
            : name === "NotReadableError"
              ? "Kamera sedang dipakai aplikasi lain."
              : "Gagal mengambil foto bukti.";
        toast.warning(message, { duration: Infinity });
        console.warn("Kamera tidak tersedia/izin ditolak:", err);
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
      }
    },
    [uploadBlob],
  );

  const recordClip = useCallback(
    async (alarmId: Id<"alarms">, kind: "audio" | "video", durationSec: number) => {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          kind === "video" ? { video: { facingMode: "environment" }, audio: true } : { audio: true },
        );
        const chunks: BlobPart[] = [];
        const preferredTypes =
          kind === "video"
            ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
            : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
        const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
        if (!mimeType) {
          toast.warning(
            `Browser ini tidak mendukung format perekaman ${kind === "video" ? "video" : "audio"}. Coba pakai Chrome/Firefox versi terbaru.`,
            { duration: Infinity },
          );
          return;
        }
        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        const done = new Promise<Blob>((resolve) => {
          recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        });

        recorder.start();
        await new Promise((r) => setTimeout(r, durationSec * 1000));
        recorder.stop();
        const blob = await done;
        void uploadBlob(alarmId, kind, blob);
      } catch (err) {
        // Video butuh izin KAMERA + MIKROFON sekaligus dalam satu permintaan —
        // kalau salah satunya diblokir (mic, meski kamera sudah "Allow"),
        // seluruh permintaan gagal. Munculkan pesan yang jelas, jangan cuma
        // console.warn, supaya user tahu apa yang perlu dicek.
        const name = err instanceof DOMException ? err.name : "";
        let message = `Gagal merekam ${kind === "video" ? "video" : "audio"}${err instanceof Error ? `: ${err.name} - ${err.message}` : ""}`;
        if (name === "NotAllowedError") {
          message =
            kind === "video"
              ? "Video butuh izin KAMERA dan MIKROFON. Cek pengaturan izin situs ini — kemungkinan salah satunya diblokir."
              : "Izin mikrofon diblokir. Cek pengaturan izin situs ini di browser.";
        } else if (name === "NotFoundError") {
          message = `Perangkat ${kind === "video" ? "kamera/mikrofon" : "mikrofon"} tidak ditemukan.`;
        } else if (name === "NotReadableError") {
          message = `${kind === "video" ? "Kamera" : "Mikrofon"} sedang dipakai aplikasi lain.`;
        }
        toast.warning(message, { duration: Infinity });
        console.warn(`${kind} tidak tersedia/izin ditolak:`, err);
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
      }
    },
    [uploadBlob],
  );

  /**
   * Fire-and-forget: capture whichever types are enabled, upload each as it
   * finishes. Never throws — a denied permission or unsupported device just
   * means no evidence for that type, the alarm itself is never affected.
   * Runs all enabled types in parallel (separate camera/mic activations
   * don't block each other).
   */
  const captureAndUpload = useCallback(
    async (alarmId: Id<"alarms">, types: EvidenceType[], durationSec: number) => {
      // Audio tidak pakai kamera, jadi aman dijalankan paralel dengan yang lain.
      const parallelTasks: Promise<void>[] = [];
      if (types.includes("audio")) {
        parallelTasks.push(recordClip(alarmId, "audio", Math.max(10, Math.min(durationSec, 30))));
      }

      // Foto dan video SAMA-SAMA butuh kamera — di banyak browser mobile,
      // hanya satu stream kamera yang boleh aktif dalam satu waktu. Kalau
      // dijalankan bersamaan (Promise.all), salah satunya bisa gagal diam-diam
      // karena kamera sedang dipakai proses yang lain. Jalankan berurutan.
      const cameraTask = (async () => {
        if (types.includes("photo")) await capturePhotoBurst(alarmId, 3, 5);
        if (types.includes("video")) await recordClip(alarmId, "video", Math.max(5, Math.min(durationSec, 20)));
      })();

      await Promise.all([...parallelTasks, cameraTask]);
    },
    [capturePhotoBurst, recordClip],
  );

  return { captureAndUpload };
}
