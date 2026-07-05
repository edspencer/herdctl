import { describe, expect, it } from "vitest";
import { MessageQueue } from "../message-queue.js";

describe("MessageQueue", () => {
  it("delivers values pushed before the consumer awaits (buffering)", async () => {
    const q = new MessageQueue<number>();
    q.push(1);
    q.push(2);
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: 1, done: false });
    expect(await it.next()).toEqual({ value: 2, done: false });
  });

  it("resolves a pending consumer when a value is pushed later", async () => {
    const q = new MessageQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next(); // await before any push
    q.push("hello");
    expect(await pending).toEqual({ value: "hello", done: false });
  });

  it("stays open across many turns (does not complete until end)", async () => {
    const q = new MessageQueue<number>();
    const received: number[] = [];
    const consumer = (async () => {
      for await (const v of q) received.push(v);
    })();
    q.push(10);
    q.push(20);
    // Give the consumer a tick to drain, then keep going — the loop must not end.
    await new Promise((r) => setImmediate(r));
    q.push(30);
    q.end();
    await consumer;
    expect(received).toEqual([10, 20, 30]);
  });

  it("completes pending consumers when ended", async () => {
    const q = new MessageQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.end();
    expect(await pending).toEqual({ value: undefined, done: true });
  });

  it("reports done for next() after end()", async () => {
    const q = new MessageQueue<number>();
    q.end();
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });

  it("ignores pushes after end()", async () => {
    const q = new MessageQueue<number>();
    q.end();
    q.push(99); // no-op
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });

  it("end() is idempotent", () => {
    const q = new MessageQueue<number>();
    q.end();
    expect(() => q.end()).not.toThrow();
  });

  it("return() on the iterator ends the queue", async () => {
    const q = new MessageQueue<number>();
    const it = q[Symbol.asyncIterator]();
    expect(await it.return?.()).toEqual({ value: undefined, done: true });
    // Subsequent pushes are ignored and next() is done.
    q.push(1);
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });
});
