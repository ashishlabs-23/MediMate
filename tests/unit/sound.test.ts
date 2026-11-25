import { afterEach, describe, expect, it, vi } from 'vitest';
import { playConfirmationChime } from '../../src/lib/sound';

interface WindowAudioTestAccess {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
}

interface RecordedOscillator {
  type: OscillatorType;
  frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

interface RecordedGain {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

function createMockAudioContextClass(options?: {
  state?: AudioContextState;
  resumeImpl?: () => Promise<void>;
  closeImpl?: () => Promise<void>;
  throwOnCreateOscillator?: boolean;
}) {
  const oscillators: RecordedOscillator[] = [];
  const gains: RecordedGain[] = [];
  const resumeSpy = vi.fn(options?.resumeImpl ?? (() => Promise.resolve()));
  const closeSpy = vi.fn(options?.closeImpl ?? (() => Promise.resolve()));

  class MockAudioContext {
    state: AudioContextState = options?.state ?? 'running';
    currentTime = 1.5;
    destination = {};
    resume = resumeSpy;
    close = closeSpy;

    createOscillator() {
      if (options?.throwOnCreateOscillator) {
        throw new Error('Audio node creation blocked');
      }
      const osc: RecordedOscillator = {
        type: 'sine',
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(osc);
      return osc;
    }

    createGain() {
      const gain: RecordedGain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }
  }

  return { MockAudioContext, oscillators, gains, resumeSpy, closeSpy };
}

describe('lib/sound playConfirmationChime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    const win = window as unknown as WindowAudioTestAccess;
    delete win.AudioContext;
    delete win.webkitAudioContext;
  });

  it('safely no-ops when AudioContext and webkitAudioContext are unavailable (jsdom/headless)', () => {
    const win = window as unknown as WindowAudioTestAccess;
    delete win.AudioContext;
    delete win.webkitAudioContext;

    expect(() => playConfirmationChime()).not.toThrow();
  });

  it('synthesizes a 440Hz -> 520Hz two-tone sine chime and closes context on ended', () => {
    const { MockAudioContext, oscillators, gains, closeSpy } = createMockAudioContextClass();
    (window as unknown as WindowAudioTestAccess).AudioContext = MockAudioContext;

    playConfirmationChime();

    expect(oscillators).toHaveLength(2);
    expect(gains).toHaveLength(2);

    const [osc1, osc2] = oscillators;
    expect(osc1?.type).toBe('sine');
    expect(osc1?.frequency.setValueAtTime).toHaveBeenCalledWith(440, 1.5);
    expect(osc1?.start).toHaveBeenCalledWith(1.5);
    expect(osc1?.stop).toHaveBeenCalledWith(expect.closeTo(1.68, 5));
    expect(osc1?.connect).toHaveBeenCalledWith(gains[0]);

    expect(osc2?.type).toBe('sine');
    expect(osc2?.frequency.setValueAtTime).toHaveBeenCalledWith(520, expect.closeTo(1.64, 5));
    expect(osc2?.start).toHaveBeenCalledWith(expect.closeTo(1.64, 5));
    expect(osc2?.stop).toHaveBeenCalledWith(expect.closeTo(1.92, 5));
    expect(osc2?.connect).toHaveBeenCalledWith(gains[1]);

    expect(closeSpy).not.toHaveBeenCalled();
    osc2?.onended?.();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to webkitAudioContext when standard AudioContext is absent', () => {
    const { MockAudioContext, oscillators } = createMockAudioContextClass();
    const win = window as unknown as WindowAudioTestAccess;
    delete win.AudioContext;
    win.webkitAudioContext = MockAudioContext;

    playConfirmationChime();

    expect(oscillators).toHaveLength(2);
    expect(oscillators[0]?.frequency.setValueAtTime).toHaveBeenCalledWith(440, 1.5);
    expect(oscillators[1]?.frequency.setValueAtTime).toHaveBeenCalledWith(
      520,
      expect.closeTo(1.64, 5)
    );
  });

  it('handles suspended AudioContext and rejected resume() without throwing', async () => {
    const { MockAudioContext, resumeSpy } = createMockAudioContextClass({
      state: 'suspended',
      resumeImpl: () => Promise.reject(new Error('Autoplay policy blocked')),
    });
    (window as unknown as WindowAudioTestAccess).AudioContext = MockAudioContext;

    expect(() => playConfirmationChime()).not.toThrow();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it('catches errors when AudioContext constructor or createOscillator throws', () => {
    class ThrowingAudioContext {
      constructor() {
        throw new Error('AudioContext disabled');
      }
    }
    (window as unknown as WindowAudioTestAccess).AudioContext = ThrowingAudioContext;
    expect(() => playConfirmationChime()).not.toThrow();

    const { MockAudioContext, closeSpy } = createMockAudioContextClass({
      throwOnCreateOscillator: true,
    });
    (window as unknown as WindowAudioTestAccess).AudioContext = MockAudioContext;
    expect(() => playConfirmationChime()).not.toThrow();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
