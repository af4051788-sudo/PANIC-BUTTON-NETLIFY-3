import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { motion, AnimatePresence } from "motion/react";
import { MessageCircle, Send } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

/**
 * Chat singkat per-alarm — buat penekan panic & responder koordinasi cepat
 * ("saya di jalan", "sudah aman", dll) selama alarm masih aktif. Bukan chat
 * umum, cuma nempel ke 1 alarm spesifik, otomatis hilang relevansinya begitu
 * alarm di-resolve (pesan tetap tersimpan di riwayat, cuma tidak bisa kirim
 * baru lagi — dicegah di backend).
 */
export function AlarmChatPanel({ alarmId }: { alarmId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const messages = useQuery(api.alarmChat.getMessages, expanded ? { alarmId: alarmId as Id<"alarms"> } : "skip");
  const sendMessage = useMutation(api.alarmChat.sendMessage);
  const listEndRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (expanded) listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, expanded]);

  // Badge notifikasi kecil kalau ada pesan baru masuk sementara panel tertutup.
  const unread = !expanded && messages ? messages.length - prevCountRef.current : 0;
  useEffect(() => {
    if (messages) prevCountRef.current = messages.length;
  }, [messages]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await sendMessage({ alarmId: alarmId as Id<"alarms">, text: trimmed });
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal kirim pesan.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-white/70 bg-white/5 border border-white/15 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors relative"
      >
        <MessageCircle className="size-3.5" />
        {expanded ? "Tutup Chat" : "Chat Koordinasi"}
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-black rounded-full size-4 flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 bg-black/30 border border-white/10 rounded-xl p-2 space-y-2">
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {messages === undefined ? (
                  <p className="text-[10px] text-white/50 text-center py-2">Memuat...</p>
                ) : messages.length === 0 ? (
                  <p className="text-[10px] text-white/50 text-center py-2">Belum ada pesan. Mulai koordinasi di sini.</p>
                ) : (
                  messages.map((m) => (
                    <div key={m._id} className={`flex flex-col ${m.isMe ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[85%] rounded-xl px-2.5 py-1.5 ${m.isMe ? "bg-primary text-primary-foreground" : "bg-white/10 text-white"}`}>
                        {!m.isMe && <p className="text-[9px] font-bold opacity-70 mb-0.5">{m.senderName}</p>}
                        <p className="text-xs break-words">{m.text}</p>
                      </div>
                      <span className="text-[9px] text-white/40 mt-0.5">{format(new Date(m.createdAt), "HH:mm", { locale: idLocale })}</span>
                    </div>
                  ))
                )}
                <div ref={listEndRef} />
              </div>
              <div className="flex gap-1.5">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                  placeholder="Tulis pesan..."
                  maxLength={500}
                  className="flex-1 bg-white/10 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/30"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !text.trim()}
                  className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 cursor-pointer"
                >
                  <Send className="size-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
