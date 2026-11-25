import { describe, expect, it } from 'vitest';
import { evaluateDoseState } from '@/domain/stateMachine';
import type { DoseAction, DoseStatus } from '@/types/dose';

const T_MS = new Date('2026-11-25T08:00:00.000Z').getTime();
const MINUTE_MS = 60_000;

function atOffset(offsetMs: number): Date {
  return new Date(T_MS + offsetMs);
}

describe('domain/stateMachine', () => {
  it('SM-01: remains scheduled 1ms before scheduledTime T', () => {
    const result = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: atOffset(0),
      currentTime: atOffset(-1),
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('scheduled');
    expect(result.snoozeCount).toBe(0);
    expect(result.snoozeUntil).toBeNull();
    expect(result.sendInitialReminder).toBe(false);
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('SM-02: transitions scheduled -> due at exact scheduledTime T', () => {
    const result = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: atOffset(0),
      currentTime: atOffset(0),
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.sendInitialReminder).toBe(true);
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('SM-03: catch-up scheduled -> due with gentle reminder at T+15m', () => {
    const result = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: atOffset(0),
      currentTime: atOffset(15 * MINUTE_MS),
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.sendInitialReminder).toBe(true);
    expect(result.sendGentleReminder).toBe(true);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('SM-04: catch-up scheduled -> unconfirmed at T+30m', () => {
    const current = atOffset(30 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: atOffset(0),
      currentTime: current,
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('unconfirmed');
    expect(result.escalatedAt?.getTime()).toBe(current.getTime());
    expect(result.sendEscalationAlert).toBe(true);
    expect(result.sendGentleReminder).toBe(false);
  });

  it('SM-05: due -> taken on tapTaken', () => {
    const current = atOffset(2 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: atOffset(0),
      currentTime: current,
      snoozeCount: 0,
      action: 'tapTaken',
    });

    expect(result.nextStatus).toBe('taken');
    expect(result.takenAt?.getTime()).toBe(current.getTime());
    expect(result.snoozeUntil).toBeNull();
    expect(result.sendInitialReminder).toBe(false);
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('SM-06: due simultaneous tapTaken at exact T+30m wins over escalation', () => {
    const current = atOffset(30 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: atOffset(0),
      currentTime: current,
      snoozeCount: 0,
      action: 'tapTaken',
    });

    expect(result.nextStatus).toBe('taken');
    expect(result.takenAt?.getTime()).toBe(current.getTime());
    expect(result.sendEscalationAlert).toBe(false);
    expect(result.escalatedAt).toBeNull();
  });

  it('SM-07: due -> snoozed on first tapSnooze sets snoozeCount=1 and +10m snoozeUntil', () => {
    const current = atOffset(3 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: atOffset(0),
      currentTime: current,
      snoozeCount: 0,
      action: 'tapSnooze',
    });

    expect(result.nextStatus).toBe('snoozed');
    expect(result.snoozeCount).toBe(1);
    expect(result.snoozeUntil?.getTime()).toBe(atOffset(13 * MINUTE_MS).getTime());
    expect(result.sendInitialReminder).toBe(false);
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('SM-08: second snooze is rejected when snoozeCount === 1', () => {
    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: atOffset(0),
        currentTime: atOffset(14 * MINUTE_MS),
        snoozeCount: 1,
        action: 'tapSnooze',
      })
    ).toThrow(/Illegal transition/);
  });

  it('SM-09: snooze is rejected at or after T+30m escalation boundary', () => {
    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: atOffset(0),
        currentTime: atOffset(30 * MINUTE_MS),
        snoozeCount: 0,
        action: 'tapSnooze',
      })
    ).toThrow(/Illegal transition/);
  });

  it('SM-10: active snoozed remains snoozed 1ms before snoozeUntil', () => {
    const snoozeUntil = atOffset(12 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: atOffset(0),
      currentTime: new Date(snoozeUntil.getTime() - 1),
      snoozeCount: 1,
      snoozeUntil,
    });

    expect(result.nextStatus).toBe('snoozed');
    expect(result.snoozeUntil?.getTime()).toBe(snoozeUntil.getTime());
    expect(result.sendGentleReminder).toBe(false);
  });

  it('SM-11: snoozed -> due at exact snoozeUntil before T+15m without gentle reminder', () => {
    const snoozeUntil = atOffset(12 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: atOffset(0),
      currentTime: snoozeUntil,
      snoozeCount: 1,
      snoozeUntil,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.snoozeCount).toBe(1);
    expect(result.snoozeUntil).toBeNull();
    expect(result.sendInitialReminder).toBe(true);
    expect(result.sendGentleReminder).toBe(false);
  });

  it('SM-12: active snoozed suppresses gentle reminder at T+16m while snoozeUntil is T+20m', () => {
    const result = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: atOffset(0),
      currentTime: atOffset(16 * MINUTE_MS),
      snoozeCount: 1,
      snoozeUntil: atOffset(20 * MINUTE_MS),
    });

    expect(result.nextStatus).toBe('snoozed');
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('SM-13: snoozed expiring at or after T+15m transitions to due and fires gentle reminder', () => {
    const snoozeUntil = atOffset(15 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: atOffset(0),
      currentTime: snoozeUntil,
      snoozeCount: 1,
      snoozeUntil,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.snoozeUntil).toBeNull();
    expect(result.sendInitialReminder).toBe(true);
    expect(result.sendGentleReminder).toBe(true);
  });

  it('SM-14: early confirmation transitions snoozed -> taken on tapTaken', () => {
    const current = atOffset(8 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: atOffset(0),
      currentTime: current,
      snoozeCount: 1,
      snoozeUntil: atOffset(15 * MINUTE_MS),
      action: 'tapTaken',
    });

    expect(result.nextStatus).toBe('taken');
    expect(result.takenAt?.getTime()).toBe(current.getTime());
    expect(result.snoozeUntil).toBeNull();
  });

  it('SM-15: gentle reminder boundary on due is false at T+15m-1ms and true at T+15m', () => {
    const before = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: atOffset(0),
      currentTime: atOffset(15 * MINUTE_MS - 1),
      snoozeCount: 0,
    });
    expect(before.nextStatus).toBe('due');
    expect(before.sendGentleReminder).toBe(false);

    const exact = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: atOffset(0),
      currentTime: atOffset(15 * MINUTE_MS),
      snoozeCount: 0,
    });
    expect(exact.nextStatus).toBe('due');
    expect(exact.sendGentleReminder).toBe(true);
  });

  it('SM-16: escalation boundary on due stays due at T+30m-1ms and escalates at exact T+30m', () => {
    const before = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: atOffset(0),
      currentTime: atOffset(30 * MINUTE_MS - 1),
      snoozeCount: 0,
    });
    expect(before.nextStatus).toBe('due');
    expect(before.sendEscalationAlert).toBe(false);

    const escalationTime = atOffset(30 * MINUTE_MS);
    const exact = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: atOffset(0),
      currentTime: escalationTime,
      snoozeCount: 0,
    });
    expect(exact.nextStatus).toBe('unconfirmed');
    expect(exact.escalatedAt?.getTime()).toBe(escalationTime.getTime());
    expect(exact.sendEscalationAlert).toBe(true);
    expect(exact.sendGentleReminder).toBe(false);
  });

  it('SM-17: T+25m snooze is overridden by authoritative T+30m escalation ceiling and allows late confirmation', () => {
    const scheduledTime = atOffset(0);

    // Step 1: snooze at T+25m (snoozeUntil = T+35m)
    const step1 = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime,
      currentTime: atOffset(25 * MINUTE_MS),
      snoozeCount: 0,
      action: 'tapSnooze',
    });
    expect(step1.nextStatus).toBe('snoozed');
    expect(step1.snoozeCount).toBe(1);
    expect(step1.snoozeUntil?.getTime()).toBe(atOffset(35 * MINUTE_MS).getTime());

    // Step 2: stays snoozed at T+29m59s
    const step2 = evaluateDoseState({
      currentStatus: step1.nextStatus,
      scheduledTime,
      currentTime: atOffset(29 * MINUTE_MS + 59_000),
      snoozeCount: step1.snoozeCount,
      snoozeUntil: step1.snoozeUntil,
    });
    expect(step2.nextStatus).toBe('snoozed');
    expect(step2.sendEscalationAlert).toBe(false);

    // Step 3: escalates to unconfirmed at T+30m despite active snoozeUntil=T+35m
    const escalationTime = atOffset(30 * MINUTE_MS);
    const step3 = evaluateDoseState({
      currentStatus: step2.nextStatus,
      scheduledTime,
      currentTime: escalationTime,
      snoozeCount: step2.snoozeCount,
      snoozeUntil: step2.snoozeUntil,
    });
    expect(step3.nextStatus).toBe('unconfirmed');
    expect(step3.snoozeUntil).toBeNull();
    expect(step3.escalatedAt?.getTime()).toBe(escalationTime.getTime());
    expect(step3.sendEscalationAlert).toBe(true);

    // Step 4: late confirmation at T+35m transitions unconfirmed -> taken
    const takenTime = atOffset(35 * MINUTE_MS);
    const step4 = evaluateDoseState({
      currentStatus: step3.nextStatus,
      scheduledTime,
      currentTime: takenTime,
      snoozeCount: step3.snoozeCount,
      action: 'tapTaken',
    });
    expect(step4.nextStatus).toBe('taken');
    expect(step4.takenAt?.getTime()).toBe(takenTime.getTime());
  });

  it('SM-18: already unconfirmed remains unconfirmed without re-emitting escalation alerts', () => {
    const result = evaluateDoseState({
      currentStatus: 'unconfirmed',
      scheduledTime: atOffset(0),
      currentTime: atOffset(45 * MINUTE_MS),
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('unconfirmed');
    expect(result.sendEscalationAlert).toBe(false);
    expect(result.escalatedAt).toBeNull();
  });

  it('SM-19: late confirmation transitions unconfirmed -> taken', () => {
    const current = atOffset(90 * MINUTE_MS);
    const result = evaluateDoseState({
      currentStatus: 'unconfirmed',
      scheduledTime: atOffset(0),
      currentTime: current,
      snoozeCount: 1,
      action: 'tapTaken',
    });

    expect(result.nextStatus).toBe('taken');
    expect(result.takenAt?.getTime()).toBe(current.getTime());
    expect(result.snoozeUntil).toBeNull();
  });

  it('SM-20: markMissed transitions every non-terminal state (due, snoozed, unconfirmed, post-T scheduled) to missed', () => {
    const current = atOffset(240 * MINUTE_MS);
    const nonTerminalStates: readonly DoseStatus[] = [
      'due',
      'snoozed',
      'unconfirmed',
      'scheduled',
    ];

    for (const status of nonTerminalStates) {
      const result = evaluateDoseState({
        currentStatus: status,
        scheduledTime: atOffset(0),
        currentTime: current,
        snoozeCount: status === 'snoozed' ? 1 : 0,
        snoozeUntil: status === 'snoozed' ? atOffset(10 * MINUTE_MS) : null,
        action: 'markMissed',
      });

      expect(result.nextStatus).toBe('missed');
      expect(result.missedAt?.getTime()).toBe(current.getTime());
      expect(result.snoozeUntil).toBeNull();
    }
  });

  it('SM-21: EOD cross-midnight markMissed closeout (23:55Z -> 00:05Z next day)', () => {
    const scheduled = new Date('2026-11-25T23:55:00.000Z');
    const closeout = new Date('2026-11-26T00:05:00.000Z');
    const result = evaluateDoseState({
      currentStatus: 'unconfirmed',
      scheduledTime: scheduled,
      currentTime: closeout,
      snoozeCount: 0,
      action: 'markMissed',
    });

    expect(result.nextStatus).toBe('missed');
    expect(result.missedAt?.toISOString()).toBe('2026-11-26T00:05:00.000Z');
  });

  it('SM-22: rapid double-tap tapTaken on taken dose is idempotent without throwing', () => {
    const result = evaluateDoseState({
      currentStatus: 'taken',
      scheduledTime: atOffset(0),
      currentTime: atOffset(5 * MINUTE_MS),
      snoozeCount: 0,
      action: 'tapTaken',
    });

    expect(result.nextStatus).toBe('taken');
    expect(result.takenAt).toBeNull();
    expect(result.snoozeUntil).toBeNull();
    expect(result.sendInitialReminder).toBe(false);
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('SM-23: terminal states taken and missed remain immutable on passive clock ticks past T+30m', () => {
    const takenResult = evaluateDoseState({
      currentStatus: 'taken',
      scheduledTime: atOffset(0),
      currentTime: atOffset(60 * MINUTE_MS),
      snoozeCount: 0,
    });
    expect(takenResult.nextStatus).toBe('taken');
    expect(takenResult.sendEscalationAlert).toBe(false);

    const missedResult = evaluateDoseState({
      currentStatus: 'missed',
      scheduledTime: atOffset(0),
      currentTime: atOffset(60 * MINUTE_MS),
      snoozeCount: 0,
    });
    expect(missedResult.nextStatus).toBe('missed');
    expect(missedResult.sendEscalationAlert).toBe(false);
  });

  it('SM-24: rejects all illegal transitions with Illegal transition error', () => {
    const illegalCases: Array<{
      label: string;
      status: DoseStatus;
      offsetMs: number;
      snoozeCount: number;
      action: DoseAction;
    }> = [
      { label: 'scheduled (< T) -> tapSnooze', status: 'scheduled', offsetMs: -1000, snoozeCount: 0, action: 'tapSnooze' },
      { label: 'scheduled (at T) -> tapSnooze', status: 'scheduled', offsetMs: 0, snoozeCount: 0, action: 'tapSnooze' },
      { label: 'scheduled (< T) -> tapTaken', status: 'scheduled', offsetMs: -1000, snoozeCount: 0, action: 'tapTaken' },
      { label: 'scheduled (< T) -> markMissed', status: 'scheduled', offsetMs: -1000, snoozeCount: 0, action: 'markMissed' },
      { label: 'snoozed -> tapSnooze', status: 'snoozed', offsetMs: 5 * MINUTE_MS, snoozeCount: 1, action: 'tapSnooze' },
      { label: 'unconfirmed -> tapSnooze', status: 'unconfirmed', offsetMs: 35 * MINUTE_MS, snoozeCount: 0, action: 'tapSnooze' },
      { label: 'taken -> tapSnooze', status: 'taken', offsetMs: 5 * MINUTE_MS, snoozeCount: 0, action: 'tapSnooze' },
      { label: 'taken -> markMissed', status: 'taken', offsetMs: 5 * MINUTE_MS, snoozeCount: 0, action: 'markMissed' },
      { label: 'missed -> tapTaken', status: 'missed', offsetMs: 60 * MINUTE_MS, snoozeCount: 0, action: 'tapTaken' },
      { label: 'missed -> tapSnooze', status: 'missed', offsetMs: 60 * MINUTE_MS, snoozeCount: 0, action: 'tapSnooze' },
      { label: 'missed -> markMissed', status: 'missed', offsetMs: 60 * MINUTE_MS, snoozeCount: 0, action: 'markMissed' },
    ];

    for (const tc of illegalCases) {
      expect(
        () =>
          evaluateDoseState({
            currentStatus: tc.status,
            scheduledTime: atOffset(0),
            currentTime: atOffset(tc.offsetMs),
            snoozeCount: tc.snoozeCount,
            action: tc.action,
          }),
        tc.label
      ).toThrow(/Illegal transition/);
    }
  });

  it('SM-25: throws descriptive Invalid error for malformed inputs', () => {
    expect(() =>
      evaluateDoseState({
        currentStatus: 'unknown' as unknown as DoseStatus,
        scheduledTime: atOffset(0),
        currentTime: atOffset(0),
        snoozeCount: 0,
      })
    ).toThrow(/Invalid currentStatus/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: new Date('bad-date'),
        currentTime: atOffset(0),
        snoozeCount: 0,
      })
    ).toThrow(/Invalid scheduledTime/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: atOffset(0),
        currentTime: new Date(Number.NaN),
        snoozeCount: 0,
      })
    ).toThrow(/Invalid currentTime/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'snoozed',
        scheduledTime: atOffset(0),
        currentTime: atOffset(5 * MINUTE_MS),
        snoozeCount: 1,
        snoozeUntil: new Date('invalid'),
      })
    ).toThrow(/Invalid snoozeUntil/);

    for (const badCount of [-1, 0.5, Number.NaN]) {
      expect(() =>
        evaluateDoseState({
          currentStatus: 'due',
          scheduledTime: atOffset(0),
          currentTime: atOffset(0),
          snoozeCount: badCount,
        })
      ).toThrow(/Invalid snoozeCount/);
    }

    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: atOffset(0),
        currentTime: atOffset(0),
        snoozeCount: 0,
        action: 'unknownAction' as unknown as DoseAction,
      })
    ).toThrow(/Invalid action/);
  });
});
