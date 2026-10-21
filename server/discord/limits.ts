export class RollingWriteBudget {
  private readonly events: Array<{ at: number; priority: boolean }> = [];

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
    private readonly maxPriorityPerWindow = maxPerWindow,
  ) {}

  tryConsume(priority = false, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.events.length && this.events[0]!.at <= cutoff) this.events.shift();
    if (this.events.length >= this.maxPerWindow) return false;
    if (priority && this.events.filter((event) => event.priority).length >= this.maxPriorityPerWindow) return false;
    this.events.push({ at: now, priority });
    return true;
  }
}

export function pushSlidingSample(
  samples: number[],
  now: number,
  windowMs: number,
  maxSamples: number,
): number[] {
  const next = samples.filter((timestamp) => now - timestamp <= windowMs);
  next.push(now);
  const safeMaximum = Math.max(1, Math.floor(maxSamples));
  if (next.length > safeMaximum) next.splice(0, next.length - safeMaximum);
  return next;
}
