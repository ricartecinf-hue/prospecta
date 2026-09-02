export const OPERATION_TIME_ZONE = "America/Sao_Paulo";

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

export function isWithinOperationWindow(date: Date, startHour: number, endHour: number) {
  const hour = Number(localParts(date).hour);
  return hour >= startHour && hour < endHour;
}

function timezoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second),
  );
  return representedAsUtc - date.getTime();
}

function zonedDate(year: number, month: number, day: number, hour: number) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  return new Date(guess.getTime() - timezoneOffsetMs(guess, OPERATION_TIME_ZONE));
}

export function nextOperationWindow(date: Date, startHour: number, endHour: number) {
  if (isWithinOperationWindow(date, startHour, endHour)) return date;
  const parts = localParts(date);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  if (hour < startHour) return zonedDate(year, month, day, startHour);

  const tomorrowNoon = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const tomorrow = localParts(tomorrowNoon);
  return zonedDate(Number(tomorrow.year), Number(tomorrow.month), Number(tomorrow.day), startHour);
}
