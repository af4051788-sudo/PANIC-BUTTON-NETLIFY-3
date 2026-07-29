/**
 * Global context for incoming group alarms.
 * - Looping alarm sound starts when a new alarm arrives (respects mute setting)
 * - Sound stops when the receiver presses their own button ("Saya Merespon")
 * - The incoming list itself is server-driven and disappears automatically
 *   once the sender resolves their alarm — pressing the button does NOT
 *   hide it locally, since we still want to show the "Lihat Lokasi" button
 *   after responding.
 * - Exposes incoming alarm list (with per-alarm respondedByMe / responderCount)
 *   so any page can show an alert UI and a location button once responded.
 */
import {
    createContext,
    useContext,
    useState,
    useRef,
    useCallback,
    useEffect,
    type ReactNode,
  } from "react";
  import { useQuery, useMutation } from "convex/react";
  import { api } from "@/convex/_generated/api.js";
  import type { Id } from "@/convex/_generated/dataModel.d.ts";
  
  export interface IncomingAlarm {
    alarmId: string;
    userName: string;
    groupName: string;
    type: string;
    muteSound: boolean;
    respondedByMe: boolean;
    responderCount: number;
    isLocationTriggered: boolean;
  }
  
  interface AlarmContextType {
    /** Active incoming alarms from group members (server-driven, live) */
    incomingAlarms: IncomingAlarm[];
    /**
     * Call when the user taps "Saya Merespon" on a specific incoming alarm.
     * Stops the sound (if that was the last unmuted ringing alarm) and
     * records the response server-side — this unlocks "Lihat Lokasi" and
     * notifies the sender + rest of the group that help is coming.
     */
    respondToAlarmId: (alarmId: string) => void;
  }
  
  const AlarmContext = createContext<AlarmContextType>({
    incomingAlarms: [],
    respondToAlarmId: () => {},
  });
  
  export function useIncomingAlarms() {
    return useContext(AlarmContext);
  }
  
  // Creates a siren-like looping beep. Returns a stop function.
  function createLoopingSound(): () => void {
    let stopped = false;
  
    const loop = () => {
      if (stopped) return;
      try {
        const audioCtx = new AudioContext();
        // Three rapid siren pulses
        [[0.00, 1100], [0.22, 780], [0.44, 1100]].forEach(([t, freq]) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.type = "sawtooth";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, audioCtx.currentTime + t);
          gain.gain.linearRampToValueAtTime(0.38, audioCtx.currentTime + t + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.19);
          osc.start(audioCtx.currentTime + t);
          osc.stop(audioCtx.currentTime + t + 0.20);
        });
        setTimeout(() => {
          void audioCtx.close();
          loop();
        }, 2200);
      } catch {
        setTimeout(loop, 2500);
      }
    };
  
    loop();
    return () => { stopped = true; };
  }
  
  // ── Provider ─────────────────────────────────────────────────────────────────
  export function AlarmProvider({ children }: { children: ReactNode }) {
    const stopSoundRef = useRef<(() => void) | null>(null);
    const notifiedIds = useRef<Set<string>>(new Set());
    const baselineReady = useRef(false);
    const soundPlaying = useRef(false);
  
    const alarms = useQuery(api.groups.getMyGroupActiveAlarms, {});
    const respondMutation = useMutation(api.groups.respondToAlarm);
    const incomingAlarms = alarms ?? [];
  
    useEffect(() => {
      if (alarms === undefined) return;
  
      if (!baselineReady.current) {
        // Record all currently-active alarms as baseline so we don't sound on page load
        alarms.forEach((a) => notifiedIds.current.add(a.alarmId));
        baselineReady.current = true;
        return;
      }
  
      // Find truly new alarms (not in baseline)
      const newOnes = alarms.filter((a) => !notifiedIds.current.has(a.alarmId));
      newOnes.forEach((a) => notifiedIds.current.add(a.alarmId));
  
      // Prune resolved alarms from notified set
      const live = new Set(alarms.map((a) => a.alarmId));
      notifiedIds.current.forEach((id) => { if (!live.has(id)) notifiedIds.current.delete(id); });
  
      // Start looping sound for unmuted new alarms that haven't been responded to yet
      if (newOnes.some((a) => !a.muteSound && !a.respondedByMe) && !soundPlaying.current) {
        soundPlaying.current = true;
        stopSoundRef.current = createLoopingSound();
      }
  
      // Auto-stop when all alarms cleared or all remaining ones already responded to
      const stillRinging = alarms.some((a) => !a.respondedByMe && !a.muteSound);
      if (!stillRinging && soundPlaying.current) {
        stopSoundRef.current?.();
        stopSoundRef.current = null;
        soundPlaying.current = false;
      }
    }, [alarms]);
  
    const respondToAlarmId = useCallback((alarmId: string) => {
      void respondMutation({ alarmId: alarmId as Id<"alarms"> });
      // The sound auto-stops via the effect above once every unmuted alarm
      // is either responded-to or resolved — no need to force-stop here,
      // since there could be OTHER still-ringing incoming alarms.
    }, [respondMutation]);
  
    return (
      <AlarmContext.Provider value={{ incomingAlarms, respondToAlarmId }}>
        {children}
      </AlarmContext.Provider>
    );
  }
  