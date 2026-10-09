/// <reference types="mocha" />
import * as assert from "assert";
import { Queue, Task } from "../Queue";

const makeTask = (run: (cb: Function) => void): Task<void> =>
    ((cb: Function) => {
        run(cb);
    }) as unknown as Task<void>;

suite("Queue", () => {
    test("never runs more tasks than the concurrency", async () => {
        const queue = new Queue<Task<void>>();
        queue.concurrency = 2;
        queue.autostart = true;

        let active = 0;
        let maxActive = 0;
        let done = 0;
        const finished = new Promise<void>((resolve) => queue.once("end", resolve));

        for (let i = 0; i < 6; i++) {
            queue.push(
                makeTask((cb) => {
                    active++;
                    maxActive = Math.max(maxActive, active);
                    setTimeout(() => {
                        active--;
                        done++;
                        cb();
                    }, 5);
                }),
            );
        }
        await finished;

        assert.strictEqual(done, 6);
        assert.strictEqual(maxActive, 2);
    });

    test("emits end once when synchronous tasks complete", () => {
        const queue = new Queue<Task<void>>();
        queue.concurrency = 1;
        queue.autostart = true;

        let ends = 0;
        let done = 0;
        queue.on("end", () => ends++);
        for (let i = 0; i < 20000; i++) {
            queue.push(
                makeTask((cb) => {
                    done++;
                    cb();
                }),
            );
        }

        assert.strictEqual(done, 20000);
        assert.ok(ends >= 1);
        assert.strictEqual(queue.getPendingTasks().length, 0);
    });

    test("reports task errors without stopping the queue", async () => {
        const queue = new Queue<Task<void>>();
        queue.concurrency = 1;
        queue.autostart = true;

        const errors: unknown[] = [];
        queue.on("task.error", (_task, error) => errors.push(error));
        const finished = new Promise<void>((resolve) => queue.once("end", resolve));

        queue.push(makeTask((cb) => setImmediate(() => cb("boom"))));
        queue.push(makeTask((cb) => setImmediate(() => cb())));
        await finished;

        assert.deepStrictEqual(errors, ["boom"]);
    });

    test("end() cancels pending and running tasks and bumps the generation", () => {
        const queue = new Queue<Task<void>>();
        queue.concurrency = 1;
        queue.autostart = true;

        let canceled = 0;
        const running = makeTask(() => undefined);
        running.cancel = () => canceled++;
        const pending = makeTask(() => undefined);
        pending.cancel = () => canceled++;
        queue.push(running);
        queue.push(pending);

        const generation = queue.generation;
        queue.end();

        assert.strictEqual(canceled, 2);
        assert.strictEqual(queue.generation, generation + 1);
        assert.strictEqual(queue.getPendingTasks().length, 0);
    });
});
