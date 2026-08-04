import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

const CATEGORY_LABELS: Record<string, string> = {
  fire: "Kebakaran",
  theft: "Pencurian",
  accident: "Kecelakaan",
  medical: "Darurat Medis",
  other: "Lainnya",
};

const ALARM_TYPE_LABELS: Record<string, string> = {
  panic: "Alarm Panic",
  silent: "Silent Alert",
  escort: "Escort Mode",
  sensor: "Sensor Otomatis",
};

export interface IncidentPdfData {
  reporterName: string;
  type: string;
  sensorKind?: string;
  status: string;
  incidentCategory?: string;
  reportDescription?: string;
  responderNote?: string;
  startedAt: string;
  resolvedAt?: string;
  latitude?: number;
  longitude?: number;
  locationArea?: string;
  triggerLocationLabel?: string;
}

/**
 * Buat PDF laporan insiden dari 1 alarm — dirancang untuk dicetak/dilampirkan
 * saat lapor ke pengurus RT atau kepolisian. Dipanggil lewat dynamic import
 * (`await import("@/lib/generate-incident-pdf.ts")`) supaya jsPDF (~150KB)
 * tidak ikut membengkakkan bundle utama untuk user yang tidak pernah pakai
 * fitur ini.
 */
export function generateIncidentPdf(data: IncidentPdfData) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 20;

  const line = (height = 8) => {
    y += height;
  };

  // Header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("LAPORAN INSIDEN", margin, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text("Dibuat otomatis oleh aplikasi PANIC BUTTON", margin, y + 6);
  doc.setTextColor(0);
  y += 14;
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  line(10);

  const field = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(value || "-", pageWidth - margin * 2 - 45);
    doc.text(lines, margin + 45, y);
    line(Math.max(7, lines.length * 5.5));
  };

  const typeLabel =
    data.type === "sensor"
      ? `Sensor Otomatis — ${data.sensorKind === "fire" ? "Api" : data.sensorKind === "flood" ? "Air/Banjir" : "Pintu"}`
      : ALARM_TYPE_LABELS[data.type] ?? data.type;

  field("Dilaporkan oleh", data.reporterName);
  field("Jenis Alarm", typeLabel);
  field("Kategori Insiden", data.incidentCategory ? (CATEGORY_LABELS[data.incidentCategory] ?? data.incidentCategory) : "-");
  field("Status", data.status === "resolved" ? "Selesai Ditangani" : data.status === "false_alarm" ? "Alarm Palsu" : "Aktif");
  field("Waktu Mulai", format(new Date(data.startedAt), "EEEE, d MMMM yyyy 'pukul' HH:mm", { locale: idLocale }));
  if (data.resolvedAt) {
    field("Waktu Selesai", format(new Date(data.resolvedAt), "EEEE, d MMMM yyyy 'pukul' HH:mm", { locale: idLocale }));
  }
  if (data.triggerLocationLabel) field("Lokasi Pemicu", data.triggerLocationLabel);
  if (data.locationArea) field("Area Lokasi", data.locationArea);
  if (data.latitude && data.longitude) {
    field("Koordinat GPS", `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`);
    field("Link Peta", `https://maps.google.com/?q=${data.latitude},${data.longitude}`);
  }

  line(4);
  doc.setDrawColor(230);
  doc.line(margin, y, pageWidth - margin, y);
  line(10);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Deskripsi Kejadian", margin, y);
  line(7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const descLines = doc.splitTextToSize(data.reportDescription || "Tidak ada deskripsi tambahan.", pageWidth - margin * 2);
  doc.text(descLines, margin, y);
  line(descLines.length * 5.5 + 8);

  if (data.responderNote) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Catatan Responder", margin, y);
    line(7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const noteLines = doc.splitTextToSize(data.responderNote, pageWidth - margin * 2);
    doc.text(noteLines, margin, y);
    line(noteLines.length * 5.5 + 8);
  }

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(
    `Diunduh pada ${format(new Date(), "d MMMM yyyy HH:mm", { locale: idLocale })} — dokumen ini dibuat otomatis dan dapat dilampirkan sebagai bukti pendukung laporan resmi.`,
    margin,
    pageHeight - 12,
    { maxWidth: pageWidth - margin * 2 },
  );

  const fileDate = format(new Date(data.startedAt), "yyyy-MM-dd_HHmm");
  doc.save(`Laporan-Insiden_${fileDate}.pdf`);
}
