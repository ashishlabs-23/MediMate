/**
 * StatusChip — color-coded status pill component.
 *
 * Status → color mapping:
 *   scheduled   → slate (bg-slate-100 text-slate-700)
 *   due         → amber (bg-yellow-100 text-yellow-800)
 *   taken       → emerald (bg-emerald-100 text-emerald-800)
 *   snoozed     → blue (bg-blue-100 text-blue-800)
 *   unconfirmed → orange (bg-orange-100 text-orange-800)
 *   missed      → red (bg-red-100 text-red-800)
 */

import type { DoseStatus } from '../../types/dose';

interface StatusChipProps {
  status: DoseStatus;
  className?: string;
}

const STATUS_LABEL: Record<DoseStatus, string> = {
  scheduled: 'Upcoming',
  due: 'Due Now',
  taken: 'Taken',
  snoozed: 'Snoozed',
  unconfirmed: 'Unconfirmed',
  missed: 'Missed',
};

const STATUS_CLASSES: Record<DoseStatus, string> = {
  scheduled: 'bg-slate-100 text-slate-700',
  due: 'bg-yellow-100 text-yellow-800',
  taken: 'bg-emerald-100 text-emerald-800',
  snoozed: 'bg-blue-100 text-blue-800',
  unconfirmed: 'bg-orange-100 text-orange-800',
  missed: 'bg-red-100 text-red-800',
};

export function StatusChip({ status, className = '' }: StatusChipProps) {
  return (
    <span
      role="status"
      aria-label={`Status: ${STATUS_LABEL[status]}`}
      className={`
        inline-flex items-center px-2.5 py-0.5 rounded-full
        text-xs font-semibold leading-5 select-none
        ${STATUS_CLASSES[status]}
        ${className}
      `}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export default StatusChip;
