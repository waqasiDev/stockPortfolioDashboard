/** Today's date and clock in New York (US market time). */
export function nyNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, minute, minutes: hour * 60 + minute, weekday: parts.weekday as string };
}
