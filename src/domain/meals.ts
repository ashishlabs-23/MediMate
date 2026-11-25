/**
 * Pure domain module for deriving meal-time associations from scheduled dose timestamps.
 * Zero React or Firebase runtime dependencies.
 */

export type MealPeriod = 'breakfast' | 'lunch' | 'dinner' | 'bedtime' | null;

export interface MealAssociation {
  period: Exclude<MealPeriod, null>;
  label: string;
  emoji: string;
}

export type TimestampLike = Date | { toDate: () => Date };

function resolveDate(value: Date | TimestampLike): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (
    value !== null &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    try {
      const converted = value.toDate();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted;
      }
      return null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Maps a scheduled local timestamp to a meal period association:
 *   - 06:00–10:00 -> Breakfast (🥣)
 *   - 12:00–15:00 -> Lunch (🥗)
 *   - 18:00–20:59 -> Dinner (🍽️)
 *   - 21:00+      -> Bedtime (🌙)
 *   - Other hours or invalid dates -> null
 */
export function getMealAssociation(
  scheduledTime: Date | TimestampLike
): MealAssociation | null {
  const date = resolveDate(scheduledTime);
  if (!date) {
    return null;
  }

  const minutes = date.getHours() * 60 + date.getMinutes();

  if (minutes >= 360 && minutes <= 600) {
    return { period: 'breakfast', label: 'Breakfast', emoji: '🥣' };
  }

  if (minutes >= 720 && minutes <= 900) {
    return { period: 'lunch', label: 'Lunch', emoji: '🥗' };
  }

  if (minutes >= 1080 && minutes < 1260) {
    return { period: 'dinner', label: 'Dinner', emoji: '🍽️' };
  }

  if (minutes >= 1260) {
    return { period: 'bedtime', label: 'Bedtime', emoji: '🌙' };
  }

  return null;
}
