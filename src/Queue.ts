import { EventEmitter } from "events";

export interface Task<T> extends EventEmitter {
    (cb: Function): Promise<T> | void;
}

export class Queue<T extends Task<any>> extends EventEmitter {
    public concurrency: number = 0;
    public autostart: boolean = false;
    private running = false;

    private pendingTasks: T[] = [];
    private executionTasks: T[] = [];
    private executedTasks: T[] = [];

    constructor() {
        super();
    }

    public getPendingTasks(): T[] {
        return this.pendingTasks;
    }

    public push(task: T): this {
        this.pendingTasks.push(task);
        if (this.autostart === true) {
            this.start();
        }
        return this;
    }

    public unshift(task: T): this {
        this.pendingTasks.unshift(task);
        if (this.autostart === true) {
            this.start();
        }
        return this;
    }

    public start(): this {
        if (this.running === false) {
            this.emit("start");
        }
        this.running = true;

        if (this.executionTasks.length >= this.concurrency && this.concurrency !== 0) {
            return this;
        }
        if (this.pendingTasks.length === 0 && this.executionTasks.length === 0) {
            this.running = false;
            this.emit("end");
            this.executedTasks = [];
            return this;
        }
        if (this.pendingTasks.length > 0) {
            const next = this.next();
            if (next) {
                this.run(next);
            }
        }
        if (this.running && this.pendingTasks.length > 0) {
            this.start();
        }

        return this;
    }

    public stop(): this {
        this.running = false;

        return this;
    }

    public end(): this {
        this.running = false;
        this.emit("end");

        this.pendingTasks = [];
        this.executionTasks = [];
        this.executedTasks = [];

        return this;
    }

    public run(task: T): this {
        this.pendingTasks.splice(this.pendingTasks.indexOf(task), 1);
        this.executionTasks.push(task);

        const cb = (error?: any) => {
            if (error) {
                this.emit("task.error", task, error);
                this.executionTasks.splice(this.executionTasks.indexOf(task), 1);
                this.executedTasks.push(task);
                if (this.running) {
                    this.start();
                }
                return this;
            }

            this.emit("task.success", task);
            this.executionTasks.splice(this.executionTasks.indexOf(task), 1);
            this.executedTasks.push(task);
            if (this.running) {
                this.start();
            }
        };

        this.emit("task.start", task);
        let promise = task(cb);
        if (promise) {
            promise.then(
                (value) => {
                    this.emit("task.success", task, value);
                },
                (reason) => {
                    this.emit("task.error", task, reason);
                }
            );
            promise.finally(() => {
                this.executionTasks.splice(this.executionTasks.indexOf(task), 1);
                this.executedTasks.push(task);
                if (this.running) {
                    this.start();
                }
            });
        }
        return this;
    }

    private next(): T | null {
        if (this.pendingTasks.length === 0) {
            return null;
        }
        const first = this.pendingTasks.find((e) => true);
        if (first) {
            return first;
        }
        return null;
    }
}
