import { vi } from 'vitest';

export class TimeTravelController {
  private currentTime: Date;

  constructor(initialTime: Date = new Date('2026-11-25T08:00:00.000Z')) {
    if (Number.isNaN(initialTime.getTime())) {
      throw new Error('TimeTravelController: invalid initialTime Date');
    }
    this.currentTime = new Date(initialTime.getTime());
    vi.useFakeTimers();
    vi.setSystemTime(this.currentTime);
  }

  public getCurrentTime(): Date {
    return new Date(this.currentTime.getTime());
  }

  public advanceByMs(ms: number): Date {
    if (ms < 0) {
      throw new Error(`Cannot travel backward in time by ${ms}ms`);
    }
    this.currentTime = new Date(this.currentTime.getTime() + ms);
    vi.setSystemTime(this.currentTime);
    vi.advanceTimersByTime(ms);
    return this.getCurrentTime();
  }

  public advanceByMinutes(minutes: number): Date {
    return this.advanceBySeconds(minutes * 60);
  }

  public advanceBySeconds(seconds: number): Date {
    return this.advanceByMs(seconds * 1000);
  }

  public advanceTo(target: Date): Date {
    if (Number.isNaN(target.getTime())) {
      throw new Error('TimeTravelController: invalid target Date');
    }
    const deltaMs = target.getTime() - this.currentTime.getTime();
    if (deltaMs < 0) {
      throw new Error(
        `Cannot travel backward in time: target ${target.toISOString()} is before current ${this.currentTime.toISOString()}`
      );
    }
    this.currentTime = new Date(target.getTime());
    vi.setSystemTime(this.currentTime);
    vi.advanceTimersByTime(deltaMs);
    return this.getCurrentTime();
  }

  public advanceToDue(scheduledTime: Date): Date {
    return this.advanceTo(scheduledTime);
  }

  public advanceToGentleReminder(scheduledTime: Date): Date {
    const gentleTime = new Date(scheduledTime.getTime() + 15 * 60 * 1000);
    return this.advanceTo(gentleTime);
  }

  public advanceToEscalation(scheduledTime: Date): Date {
    const escalationTime = new Date(scheduledTime.getTime() + 30 * 60 * 1000);
    return this.advanceTo(escalationTime);
  }

  public advancePastEscalation(scheduledTime: Date, additionalMinutes: number): Date {
    const target = new Date(scheduledTime.getTime() + (30 + additionalMinutes) * 60 * 1000);
    return this.advanceTo(target);
  }

  public reset(): void {
    vi.useRealTimers();
  }
}
