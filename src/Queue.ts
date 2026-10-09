import { EventEmitter } from "events";

export interface Task<T> extends EventEmitter {
    (cb: Function): Promise<T> | void;
    // Called when the queue is ended while the task is pending or running
    cancel?: () => void;
}

export class Queue<T extends Task<any>> extends EventEmitter {
    public concurrency: number = 0;
    public autostart: boolean = false;
    private running = false;
    private filling = false;
    private _generation = 0;

    private pendingTasks: T[] = [];
    private executionTasks: T[] = [];

    constructor() {
        super();
    }

    // Incremented by end(); long-running tasks compare it to detect cancellation
    public get generation(): number {
        return this._generation;
    }

    public getPendingTasks(): T[] {
        return this.pendingTasks;
    }

    public removeAllPendingTasks(): this {
        this.pendingTasks = [];
        return this;
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
        // A task finishing synchronously calls start() again; the loop below already picks up the next one
        if (this.filling) {
            return this;
        }

        this.filling = true;
        try {
            while (this.running) {
                if (this.concurrency !== 0 && this.executionTasks.length >= this.concurrency) {
                    break;
                }
                if (this.pendingTasks.length === 0) {
                    if (this.executionTasks.length > 0) {
                        break;
                    }
                    this.running = false;
                    // An "end" listener may queue more work and restart the loop
                    this.emit("end");
                    continue;
                }
                this.run(this.pendingTasks[0]);
            }
        } finally {
            this.filling = false;
        }

        return this;
    }

    public stop(): this {
        this.running = false;

        return this;
    }

    public end(): this {
        const cancelled = [...this.pendingTasks, ...this.executionTasks];
        this._generation++;
        this.running = false;
        this.pendingTasks = [];
        this.executionTasks = [];

        this.emit("end");
        cancelled.forEach((task) => task.cancel?.());

        return this;
    }

    public run(task: T): this {
        this.pendingTasks.splice(this.pendingTasks.indexOf(task), 1);
        this.executionTasks.push(task);

        const finish = () => {
            const index = this.executionTasks.indexOf(task);
            // Not found means the queue was ended while the task was running
            if (index === -1) {
                return;
            }
            this.executionTasks.splice(index, 1);
            if (this.running) {
                this.start();
            }
        };

        const cb = (error?: any) => {
            if (error) {
                this.emit("task.error", task, error);
            } else {
                this.emit("task.success", task);
            }
            finish();
        };

        this.emit("task.start", task);
        const promise = task(cb);
        if (promise) {
            promise
                .then(
                    (value) => {
                        this.emit("task.success", task, value);
                    },
                    (reason) => {
                        this.emit("task.error", task, reason);
                    }
                )
                .then(finish);
        }
        return this;
    }
}
