// ===========================================
// SegmentQueue — bounded async FIFO
// Decouples TTS production (producer prepares sentences ahead)
// from playback (consumer emits one at a time). The bounded
// capacity is the backpressure: while the consumer is blocked
// (Q&A / pause), the producer fills the queue then waits — so
// no extra TTS is fetched while paused.
// ===========================================

export const QUEUE_CLOSED = Symbol("segment-queue-closed");

export class SegmentQueue {
  constructor(capacity = 2) {
    this.capacity = Math.max(1, capacity);
    this._items = [];
    this._closed = false;
    this._waitShift = []; // resolvers waiting for an item
    this._waitPush = []; // resolvers waiting for free space
  }

  get size() {
    return this._items.length;
  }

  /**
   * Enqueue an item. Resolves once accepted; blocks while the
   * queue is full. Returns false if the queue was closed.
   */
  async push(item) {
    while (this._items.length >= this.capacity && !this._closed) {
      await new Promise((res) => this._waitPush.push(res));
    }
    if (this._closed) return false;
    this._items.push(item);
    const w = this._waitShift.shift();
    if (w) w();
    return true;
  }

  /**
   * Dequeue the next item (FIFO). Blocks while empty. Returns
   * QUEUE_CLOSED once the queue is closed and drained.
   */
  async shift() {
    while (this._items.length === 0 && !this._closed) {
      await new Promise((res) => this._waitShift.push(res));
    }
    if (this._items.length > 0) {
      const item = this._items.shift();
      const p = this._waitPush.shift();
      if (p) p();
      return item;
    }
    return QUEUE_CLOSED;
  }

  /** Drop all buffered items (frees space for blocked pushers). */
  clear() {
    this._items = [];
    const ps = this._waitPush;
    this._waitPush = [];
    for (const p of ps) p();
  }

  /** No more items will be pushed; wakes blocked consumers/producers. */
  close() {
    this._closed = true;
    const ss = this._waitShift;
    this._waitShift = [];
    for (const s of ss) s();
    const ps = this._waitPush;
    this._waitPush = [];
    for (const p of ps) p();
  }

  get closed() {
    return this._closed;
  }
}

export default SegmentQueue;
