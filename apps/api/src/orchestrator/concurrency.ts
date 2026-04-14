export class ConcurrencyGovernor {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return Promise.resolve() }
    return new Promise<void>(resolve => { this.waiters.push(resolve) })
  }

  release(): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      // Transfer slot to waiting acquirer — active count stays the same
      waiter()
    } else {
      this.active = Math.max(0, this.active - 1)
    }
  }

  get activeCount(): number { return this.active }
  get waitingCount(): number { return this.waiters.length }
}

export let governor = new ConcurrencyGovernor(4)
export function configureGovernor(max: number): void { governor = new ConcurrencyGovernor(max) }
