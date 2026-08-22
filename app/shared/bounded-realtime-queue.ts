export type RealtimeQueueOverflowPolicy =
  "drop-oldest" | "replace-with-newest" | "reject-new";

export type BoundedQueueOptions = {
  capacity: number;
  maxAgeMs: number;
  overflow: RealtimeQueueOverflowPolicy;
  now?: () => number;
};

export type QueueAgeSample = {
  size: number;
  oldestQueuedAgeMs: number | null;
  droppedCount: number;
  lastDropReason: string | null;
};

type QueueEntry<T> = {
  value: T;
  enqueuedAt: number;
};

export class BoundedRealtimeQueue<T> {
  private entries: QueueEntry<T>[] = [];
  private droppedCount = 0;
  private lastDropReason: string | null = null;
  private options: BoundedQueueOptions;

  constructor(options: BoundedQueueOptions) {
    this.options = options;
  }

  get capacity() {
    return this.options.capacity;
  }

  get size() {
    return this.entries.length;
  }

  enqueue(value: T, at: number = this.now()): boolean {
    this.expire(at);
    while (this.entries.length >= this.options.capacity) {
      if (this.options.overflow === "reject-new") {
        this.droppedCount += 1;
        this.lastDropReason = "capacity-reject-new";
        return false;
      }
      if (this.options.overflow === "replace-with-newest") {
        this.droppedCount += this.entries.length;
        this.lastDropReason = "capacity-replace-with-newest";
        this.entries = [];
        break;
      }
      this.entries.shift();
      this.droppedCount += 1;
      this.lastDropReason = "capacity-drop-oldest";
    }
    this.entries.push({ value, enqueuedAt: at });
    return true;
  }

  dequeue(at: number = this.now()): { value: T; ageMs: number } | null {
    const entry = this.entries.shift();
    if (!entry) return null;
    return { value: entry.value, ageMs: Math.max(0, at - entry.enqueuedAt) };
  }

  drain(): T[] {
    const values = this.entries.map((entry) => entry.value);
    this.entries = [];
    return values;
  }

  expireExpired(at: number = this.now()): number {
    return this.expire(at);
  }

  sample(at: number = this.now()): QueueAgeSample {
    const oldest = this.entries[0];
    return {
      size: this.entries.length,
      oldestQueuedAgeMs:
        oldest == null ? null : Math.max(0, at - oldest.enqueuedAt),
      droppedCount: this.droppedCount,
      lastDropReason: this.lastDropReason,
    };
  }

  clear() {
    this.entries = [];
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private expire(at: number): number {
    let expired = 0;
    while (
      this.entries.length &&
      at - (this.entries[0]?.enqueuedAt ?? at) > this.options.maxAgeMs
    ) {
      this.entries.shift();
      this.droppedCount += 1;
      this.lastDropReason = "max-age-expired";
      expired += 1;
    }
    return expired;
  }
}
