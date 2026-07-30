import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X, ScanLine } from "lucide-react";

interface QRScannerModalProps {
  onScan: (data: string) => void;
  onClose: () => void;
  title?: string;
}

/**
 * Fullscreen camera scanner. Requests camera permission explicitly via
 * getUserMedia (browser prompt is unavoidable and required — we never try
 * to bypass it). Stops the camera stream the moment a code is found or the
 * modal closes, so the camera is never left running longer than needed.
 */
export function QRScannerModal({ onScan, onClose, title = "Pindai Kode QR" }: QRScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        scanLoop();
      } catch {
        setError("Tidak bisa mengakses kamera. Pastikan izin kamera diizinkan di browser.");
      }
    }

    function scanLoop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        onScan(code.data);
        return; // stop loop — cleanup effect will stop the camera
      }
      rafRef.current = requestAnimationFrame(scanLoop);
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <p className="text-white font-bold text-sm">{title}</p>
        <button onClick={onClose} className="p-2 text-white cursor-pointer">
          <X className="size-5" />
        </button>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {error ? (
          <p className="text-white/80 text-sm text-center px-8">{error}</p>
        ) : (
          <>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
            <div className="relative z-10 w-64 h-64 border-2 border-primary/80 rounded-2xl">
              <ScanLine className="absolute inset-x-0 mx-auto top-1/2 -translate-y-1/2 size-8 text-primary/70 animate-pulse" />
            </div>
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <p className="text-white/60 text-xs text-center pb-6 px-6">
        Arahkan kamera ke kode QR
      </p>
    </div>
  );
}
