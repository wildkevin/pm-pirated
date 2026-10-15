declare module 'postman-runtime' {
  interface Run {
    start(callbacks: Record<string, (...args: any[]) => void>): void
    abort(): void
  }
  const runtime: {
    Runner: new () => {
      run(collection: unknown, options: Record<string, unknown>, cb: (err: Error | null, run: Run) => void): void
    }
  }
  export default runtime
}
