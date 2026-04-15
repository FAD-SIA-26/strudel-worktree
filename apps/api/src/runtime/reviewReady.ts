export function waitForShutdownSignal(
  signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'],
): Promise<NodeJS.Signals> {
  return new Promise(resolve => {
    const disposers = signals.map(signal => {
      const handler = () => {
        for (const [registeredSignal, registeredHandler] of disposers) {
          process.off(registeredSignal, registeredHandler)
        }
        resolve(signal)
      }
      process.once(signal, handler)
      return [signal, handler] as const
    })
  })
}
