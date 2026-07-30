import { useCallback } from "react";
import { useMutation } from "convex/react";
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
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || "application/octet-stream" },
          body: blob,
        });
        if (!res.ok) return;
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await attachEvidence({ alarmId, storageId, type });
      } catch (err) {
        console.warn("Gagal upload bukti:", err);
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
        const recorder = new MediaRecorder(stream);
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
      const tasks: Promise<void>[] = [];
      if (types.includes("photo")) tasks.push(capturePhotoBurst(alarmId, 3, 5));
      if (types.includes("audio")) tasks.push(recordClip(alarmId, "audio", Math.max(10, Math.min(durationSec, 30))));
      if (types.includes("video")) tasks.push(recordClip(alarmId, "video", Math.max(5, Math.min(durationSec, 20))));
      await Promise.all(tasks);
    },
    [capturePhotoBurst, recordClip],
  );

  return { captureAndUpload };
}
