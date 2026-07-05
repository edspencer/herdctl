/**
 * A pushable async iterable used to feed user messages into the SDK's
 * streaming-input mode.
 *
 * The Claude Agent SDK's `query()` accepts `prompt: AsyncIterable<SDKUserMessage>`.
 * Unlike a one-shot string prompt, the iterable is consumed lazily and the query
 * stays alive as long as the iterable has not completed — which is exactly what a
 * long-lived chat session needs: push a message per turn, and keep the query open
 * so control requests (`interrupt`, `supportedCommands`, …) remain available.
 *
 * `push()` enqueues a value; `end()` completes the iterable so the SDK shuts the
 * session down cleanly. Values pushed before a consumer awaits are buffered.
 */
export class MessageQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  /** Enqueue a value. No-op once the queue has ended. */
  push(item: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  /** Complete the iterable. Any pending/next consumers observe `done: true`. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let waiter = this.waiters.shift();
    while (waiter) {
      waiter({ value: undefined as never, done: true });
      waiter = this.waiters.shift();
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: (): Promise<IteratorResult<T>> => {
        this.end();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }
}
