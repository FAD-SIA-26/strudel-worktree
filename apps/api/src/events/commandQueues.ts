/** Per-role in-process command transport. Not observable. Never touches event bus. */
export class CommandQueue<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(v: T) => void> = [];

  enqueue(item: T): void {
    const w = this.waiters.shift();
    if (w) {
      w(item);
    } else {
      this.buffer.push(item);
    }
  }

  dequeue(): Promise<T> {
    const item = this.buffer.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  get size(): number {
    return this.buffer.length;
  }
}
