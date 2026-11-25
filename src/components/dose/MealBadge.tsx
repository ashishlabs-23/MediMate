/**
 * MealBadge — High-contrast meal association chip paired with scheduled dose time.
 *
 * DESIGN.md compliance:
 *   - Never Color Alone: pairs emoji (aria-hidden) + plain text label.
 *   - WCAG AA/AAA contrast tokens from tailwind.config.js / DESIGN.md.
 *   - Non-interactive <span> so touch-target checks on buttons/links stay clean.
 */

import { getMealAssociation, type MealPeriod, type TimestampLike } from '../../domain/meals';

export interface MealBadgeProps {
  scheduledTime: Date | TimestampLike;
  className?: string | undefined;
}

const MEAL_STYLES: Record<Exclude<MealPeriod, null>, string> = {
  breakfast: 'bg-snooze-bg text-snooze-text border-amber-300',
  lunch: 'bg-taken-bg text-taken border-emerald-300',
  dinner: 'bg-brand-teal-light text-brand-teal-dark border-teal-300',
  bedtime: 'bg-due-bg text-due border-blue-300',
};

export function MealBadge({ scheduledTime, className = '' }: MealBadgeProps) {
  const meal = getMealAssociation(scheduledTime);
  if (!meal) {
    return null;
  }

  return (
    <span
      data-testid="meal-badge"
      data-meal-period={meal.period}
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-semibold leading-5 select-none ${MEAL_STYLES[meal.period]} ${className}`.trim()}
    >
      <span aria-hidden="true">{meal.emoji}</span>
      <span>{meal.label}</span>
    </span>
  );
}

export default MealBadge;
