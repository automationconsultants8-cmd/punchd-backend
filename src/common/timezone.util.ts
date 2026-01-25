/**
 * Timezone Utility for Punch'd Backend
 * 
 * All times in database are stored as UTC.
 * This utility converts between UTC and company timezone.
 */

// Get timezone offset for a given IANA timezone
export function getTimezoneOffset(timezone: string, date: Date = new Date()): number {
  // Returns offset in minutes (e.g., -480 for Pacific Standard Time)
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return (utcDate.getTime() - tzDate.getTime()) / (1000 * 60);
}

// Get offset string like "-08:00" or "-07:00" for a timezone
export function getTimezoneOffsetString(timezone: string, date: Date = new Date()): string {
  const offsetMinutes = getTimezoneOffset(timezone, date);
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const mins = Math.abs(offsetMinutes) % 60;
  const sign = offsetMinutes >= 0 ? '-' : '+';
  return `${sign}${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Parse a local time string (like "08:00") on a specific date in a specific timezone
 * and return a UTC Date object.
 * 
 * @param dateStr - Date string like "2026-01-25"
 * @param timeStr - Time string like "08:00" or "17:30"
 * @param timezone - IANA timezone like "America/Los_Angeles"
 * @returns Date object in UTC
 */
export function parseLocalTimeToUTC(dateStr: string, timeStr: string, timezone: string): Date {
  // Build ISO string with the timezone offset
  const offsetStr = getTimezoneOffsetString(timezone, new Date(`${dateStr}T12:00:00Z`));
  const isoString = `${dateStr}T${timeStr}:00${offsetStr}`;
  return new Date(isoString);
}

/**
 * Format a UTC date to local time string in a specific timezone
 * 
 * @param date - UTC Date object
 * @param timezone - IANA timezone like "America/Los_Angeles"
 * @param format - 'time' | 'date' | 'datetime'
 * @returns Formatted string
 */
export function formatToLocalTime(
  date: Date | string,
  timezone: string,
  format: 'time' | 'date' | 'datetime' | 'iso-date' | 'iso-time' = 'datetime'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (format === 'time') {
    return d.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  
  if (format === 'date') {
    return d.toLocaleDateString('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  
  if (format === 'iso-date') {
    // Returns YYYY-MM-DD in the local timezone
    const parts = d.toLocaleDateString('en-CA', { timeZone: timezone }).split('/');
    return d.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
  }
  
  if (format === 'iso-time') {
    // Returns HH:MM in 24hr format in the local timezone
    return d.toLocaleTimeString('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  
  // datetime
  return d.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Get the start of a day in a specific timezone as UTC
 * 
 * @param date - Reference date
 * @param timezone - IANA timezone
 * @returns UTC Date representing midnight in the timezone
 */
export function getStartOfDayInTimezone(date: Date | string, timezone: string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  const localDateStr = d.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  return parseLocalTimeToUTC(localDateStr, '00:00', timezone);
}

/**
 * Get the end of a day in a specific timezone as UTC
 * 
 * @param date - Reference date
 * @param timezone - IANA timezone
 * @returns UTC Date representing 23:59:59.999 in the timezone
 */
export function getEndOfDayInTimezone(date: Date | string, timezone: string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  const localDateStr = d.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  const endOfDay = parseLocalTimeToUTC(localDateStr, '23:59', timezone);
  endOfDay.setSeconds(59, 999);
  return endOfDay;
}

/**
 * Get the start of the week (Sunday or Monday) in a specific timezone
 * 
 * @param date - Reference date
 * @param timezone - IANA timezone
 * @param weekStartsOn - 0 for Sunday, 1 for Monday
 * @returns UTC Date representing start of week
 */
export function getStartOfWeekInTimezone(
  date: Date | string,
  timezone: string,
  weekStartsOn: number = 0
): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  const localDateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
  const localDate = new Date(localDateStr + 'T12:00:00Z'); // Use noon to avoid DST issues
  
  const dayOfWeek = localDate.getUTCDay();
  const daysToSubtract = (dayOfWeek - weekStartsOn + 7) % 7;
  
  const weekStart = new Date(localDate);
  weekStart.setUTCDate(weekStart.getUTCDate() - daysToSubtract);
  
  const weekStartStr = weekStart.toISOString().split('T')[0];
  return parseLocalTimeToUTC(weekStartStr, '00:00', timezone);
}

/**
 * Check if two dates are on the same calendar day in a specific timezone
 */
export function isSameDayInTimezone(date1: Date, date2: Date, timezone: string): boolean {
  const d1 = date1.toLocaleDateString('en-CA', { timeZone: timezone });
  const d2 = date2.toLocaleDateString('en-CA', { timeZone: timezone });
  return d1 === d2;
}

/**
 * Get local date parts from a UTC date in a specific timezone
 */
export function getLocalDateParts(date: Date | string, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
} {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  
  const parts = formatter.formatToParts(d);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  const weekdayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };
  
  return {
    year: parseInt(getPart('year')),
    month: parseInt(getPart('month')),
    day: parseInt(getPart('day')),
    hour: parseInt(getPart('hour')),
    minute: parseInt(getPart('minute')),
    dayOfWeek: weekdayMap[getPart('weekday')] || 0,
  };
}

// Default timezone constant
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

// Common US timezones
export const US_TIMEZONES = [
  'America/Los_Angeles',  // Pacific
  'America/Denver',       // Mountain
  'America/Chicago',      // Central
  'America/New_York',     // Eastern
  'America/Anchorage',    // Alaska
  'Pacific/Honolulu',     // Hawaii
];
