export class MockClock {
  private currentTime: Date;

  constructor(initialTime: Date = new Date('2026-11-25T08:00:00.000Z')) {
    if (Number.isNaN(initialTime.getTime())) {
      throw new Error('MockClock: invalid initialTime Date');
    }
    this.currentTime = new Date(initialTime.getTime());
  }

  public now(): Date {
    return new Date(this.currentTime.getTime());
  }

  public timestamp(): number {
    return this.currentTime.getTime();
  }

  public setTime(target: Date): Date {
    if (Number.isNaN(target.getTime())) {
      throw new Error('MockClock: invalid target Date');
    }
    this.currentTime = new Date(target.getTime());
    return this.now();
  }

  public advanceMs(ms: number): Date {
    if (ms < 0) {
      throw new Error(`MockClock: cannot advance by negative ms (${ms})`);
    }
    this.currentTime = new Date(this.currentTime.getTime() + ms);
    return this.now();
  }

  public advanceSeconds(seconds: number): Date {
    return this.advanceMs(seconds * 1000);
  }

  public advanceMinutes(minutes: number): Date {
    return this.advanceMs(minutes * 60 * 1000);
  }

  public reset(initialTime: Date = new Date('2026-11-25T08:00:00.000Z')): void {
    this.setTime(initialTime);
  }
}
