/**
 * Web Audio API confirmation chime synthesizer for Elderly Simple Mode.
 * Zero external dependencies; safely no-ops in headless/jsdom/SSR/blocked-autoplay environments.
 */

type AudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const win = window as WindowWithWebkitAudio;
  const ctor = win.AudioContext ?? win.webkitAudioContext;
  return typeof ctor === 'function' ? ctor : null;
}

function safeCloseAudioContext(ctx: AudioContext): void {
  try {
    if (typeof ctx.close === 'function' && ctx.state !== 'closed') {
      const result = ctx.close();
      if (result && typeof result.catch === 'function') {
        result.catch(() => undefined);
      }
    }
  } catch {
    // Ignore close errors in restricted audio environments
  }
}

/**
 * Plays a gentle two-tone sine chime (440Hz -> 520Hz) when a dose is confirmed.
 * Safe no-op if Web Audio API is unavailable or autoplay is blocked.
 */
export function playConfirmationChime(): void {
  const AudioContextCtor = resolveAudioContextConstructor();
  if (!AudioContextCtor) {
    return;
  }

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContextCtor();

    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      const resumeResult = ctx.resume();
      if (resumeResult && typeof resumeResult.catch === 'function') {
        resumeResult.catch(() => undefined);
      }
    }

    const now = typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;

    // Tone 1: 440 Hz gentle sine tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440, now);
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain1.gain.linearRampToValueAtTime(0.0001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // Tone 2: 520 Hz gentle sine tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(520, now + 0.14);
    gain2.gain.setValueAtTime(0.0001, now + 0.14);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.16);
    gain2.gain.linearRampToValueAtTime(0.0001, now + 0.42);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.42);

    const activeCtx = ctx;
    osc2.onended = () => {
      safeCloseAudioContext(activeCtx);
    };
  } catch {
    if (ctx) {
      safeCloseAudioContext(ctx);
    }
  }
}

/**
 * Plays a gentle ascending melodic chime (523Hz -> 659Hz -> 784Hz) when a dose is due.
 * Safe no-op if Web Audio API is unavailable or autoplay is blocked.
 */
export function playDueAlertTone(): void {
  const AudioContextCtor = resolveAudioContextConstructor();
  if (!AudioContextCtor) {
    return;
  }

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContextCtor();

    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      const resumeResult = ctx.resume();
      if (resumeResult && typeof resumeResult.catch === 'function') {
        resumeResult.catch(() => undefined);
      }
    }

    const now = typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 major triad

    notes.forEach((freq, idx) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = now + idx * 0.12;
      const stopAt = startAt + 0.22;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(0.12, startAt + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, stopAt);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(stopAt);

      if (idx === notes.length - 1) {
        const activeCtx = ctx;
        osc.onended = () => {
          safeCloseAudioContext(activeCtx);
        };
      }
    });
  } catch {
    if (ctx) {
      safeCloseAudioContext(ctx);
    }
  }
}

/**
 * Speaks a clear verbal reminder using the Web Speech Synthesis API.
 * Safe no-op if speechSynthesis is unavailable or speaking is disabled.
 */
export function speakReminder(medicationName: string, dosage?: string): void {
  try {
    if (
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      typeof window.SpeechSynthesisUtterance === 'undefined'
    ) {
      return;
    }
    const cleanName = medicationName.trim();
    if (!cleanName) return;

    const text = dosage
      ? `It is time to take your ${cleanName}, ${dosage}.`
      : `It is time to take your ${cleanName}.`;

    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.rate = 0.9; // Clear, calm cadence for elderly listeners
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis errors in restricted/headless environments
  }
}
