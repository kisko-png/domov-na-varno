import { formatInstant } from "../core/time.js";
import type { ClockRepository } from "../repositories/clock.js";

/** The simulated clock as the API shows it. */
export interface SimClock {
  now: string;
  offsetMinutes: number;
}

/** The simulated now: the real clock plus a stored offset in minutes. */
export class ClockService {
  /** Creates the clock over its offset store and a real clock in epoch milliseconds. */
  constructor(
    private readonly repo: ClockRepository,
    private readonly realNow: () => number,
  ) {}

  /** The simulated now. */
  now(): Date {
    return new Date(this.realNow() + this.repo.getOffsetMinutes() * 60000);
  }

  /** The simulated now and its offset. */
  current(): SimClock {
    return {
      now: formatInstant(this.now().getTime()),
      offsetMinutes: this.repo.getOffsetMinutes(),
    };
  }

  /** Adds `minutes` to the offset and returns the new clock. */
  advance(minutes: number): SimClock {
    this.repo.setOffsetMinutes(this.repo.getOffsetMinutes() + minutes);
    return this.current();
  }
}
