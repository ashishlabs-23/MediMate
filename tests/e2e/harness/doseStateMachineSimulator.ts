import {
  canSnooze,
  DoseStatus,
  DoseTransitionResult,
  evaluateDoseState,
} from './contractStubs';
import { TimeTravelController } from './timeTravelController';

export interface SimulatedDoseRecord {
  id: string;
  patientId: string;
  medicationName: string;
  scheduledTime: Date;
  status: DoseStatus;
  snoozeCount: number;
  snoozeUntil?: Date | null;
  takenAt?: Date | null;
  takenBy?: string | null;
  escalatedAt?: Date | null;
  missedAt?: Date | null;
  escalationAlertSent: boolean;
  followUpSent: boolean;
}

export type SnapshotSubscriber = (dose: SimulatedDoseRecord) => void;

export class DoseStateMachineSimulator {
  private dose: SimulatedDoseRecord;
  private timeTravel: TimeTravelController;
  private subscribers: Set<SnapshotSubscriber> = new Set();

  constructor(initialDose: SimulatedDoseRecord, timeTravel: TimeTravelController) {
    this.dose = {
      ...initialDose,
      scheduledTime: new Date(initialDose.scheduledTime.getTime()),
      snoozeUntil: initialDose.snoozeUntil ? new Date(initialDose.snoozeUntil.getTime()) : null,
      takenAt: initialDose.takenAt ? new Date(initialDose.takenAt.getTime()) : null,
      escalatedAt: initialDose.escalatedAt ? new Date(initialDose.escalatedAt.getTime()) : null,
      missedAt: initialDose.missedAt ? new Date(initialDose.missedAt.getTime()) : null,
    };
    this.timeTravel = timeTravel;
  }

  public subscribe(subscriber: SnapshotSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getDose());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notify(): void {
    const snapshot = this.getDose();
    this.subscribers.forEach((sub) => sub(snapshot));
  }

  public getDose(): SimulatedDoseRecord {
    return {
      ...this.dose,
      scheduledTime: new Date(this.dose.scheduledTime.getTime()),
      snoozeUntil: this.dose.snoozeUntil ? new Date(this.dose.snoozeUntil.getTime()) : null,
      takenAt: this.dose.takenAt ? new Date(this.dose.takenAt.getTime()) : null,
      escalatedAt: this.dose.escalatedAt ? new Date(this.dose.escalatedAt.getTime()) : null,
      missedAt: this.dose.missedAt ? new Date(this.dose.missedAt.getTime()) : null,
    };
  }

  public tick(): DoseTransitionResult {
    const result = evaluateDoseState({
      currentStatus: this.dose.status,
      scheduledTime: this.dose.scheduledTime,
      currentTime: this.timeTravel.getCurrentTime(),
      snoozeCount: this.dose.snoozeCount,
      snoozeUntil: this.dose.snoozeUntil,
    });

    this.dose.status = result.nextStatus;
    this.dose.snoozeUntil = result.snoozeUntil ?? null;
    if (result.sendGentleReminder) {
      this.dose.followUpSent = true;
    }
    // R1 client-side fix: client transitions status to 'unconfirmed' with snoozeUntil: null ONLY;
    // backend/Functions escalation sets escalationAlertSent: true and escalatedAt after caregiver FCM.
    this.notify();
    return result;
  }

  public tapTaken(takenBy: string = this.dose.patientId): DoseTransitionResult {
    if (this.dose.status === 'taken') {
      return {
        nextStatus: 'taken',
        snoozeCount: this.dose.snoozeCount,
        takenAt: this.dose.takenAt,
        sendGentleReminder: false,
        sendEscalationAlert: false,
      };
    }

    const result = evaluateDoseState({
      currentStatus: this.dose.status,
      scheduledTime: this.dose.scheduledTime,
      currentTime: this.timeTravel.getCurrentTime(),
      snoozeCount: this.dose.snoozeCount,
      snoozeUntil: this.dose.snoozeUntil,
      action: 'tapTaken',
    });

    this.dose.status = result.nextStatus;
    this.dose.takenAt = result.takenAt ?? this.timeTravel.getCurrentTime();
    this.dose.takenBy = takenBy;
    this.dose.snoozeUntil = null;
    this.notify();
    return result;
  }

  public tapSnooze(): boolean {
    if (!canSnooze(this.dose.snoozeCount, this.dose.status)) {
      return false;
    }

    const result = evaluateDoseState({
      currentStatus: this.dose.status,
      scheduledTime: this.dose.scheduledTime,
      currentTime: this.timeTravel.getCurrentTime(),
      snoozeCount: this.dose.snoozeCount,
      snoozeUntil: this.dose.snoozeUntil,
      action: 'tapSnooze',
    });

    this.dose.status = result.nextStatus;
    this.dose.snoozeCount = result.snoozeCount;
    this.dose.snoozeUntil = result.snoozeUntil ?? null;
    // R1 client-side fix: client NEVER sets escalationAlertSent: true or escalatedAt.
    this.notify();
    return result.nextStatus === 'snoozed';
  }

  public markMissed(): DoseTransitionResult {
    const result = evaluateDoseState({
      currentStatus: this.dose.status,
      scheduledTime: this.dose.scheduledTime,
      currentTime: this.timeTravel.getCurrentTime(),
      snoozeCount: this.dose.snoozeCount,
      snoozeUntil: this.dose.snoozeUntil,
      action: 'markMissed',
    });

    this.dose.status = result.nextStatus;
    this.dose.missedAt = result.missedAt ?? this.timeTravel.getCurrentTime();
    this.notify();
    return result;
  }
}
