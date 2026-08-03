import type { QueueJob } from './types.js';

/**
 * Min-heap priority queue keyed on (priority, createdAt).
 * Lower priority value = higher urgency.
 */
export class PriorityQueue {
  private heap: QueueJob[] = [];

  push(job: QueueJob): void {
    this.heap.push(job);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): QueueJob | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): QueueJob | undefined {
    return this.heap[0];
  }

  get size(): number {
    return this.heap.length;
  }

  private compare(a: QueueJob, b: QueueJob): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.createdAt < b.createdAt; // FIFO within same priority
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.compare(this.heap[idx]!, this.heap[parent]!)) {
        [this.heap[idx], this.heap[parent]] = [this.heap[parent]!, this.heap[idx]!];
        idx = parent;
      } else break;
    }
  }

  private sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = idx;
      const l = 2 * idx + 1;
      const r = 2 * idx + 2;
      if (l < n && this.compare(this.heap[l]!, this.heap[smallest]!)) smallest = l;
      if (r < n && this.compare(this.heap[r]!, this.heap[smallest]!)) smallest = r;
      if (smallest === idx) break;
      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest]!, this.heap[idx]!];
      idx = smallest;
    }
  }
}
