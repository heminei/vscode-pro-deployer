import * as vscode from "vscode";
import EventEmitter = require("events");
import { Extension } from "../extension";
import { TargetOptionsInterface } from "./Interfaces";

export abstract class Target extends EventEmitter {
    private connectWaiters: { cb: Function; errorCb?: Function }[] = [];

    constructor(private workspaceFolder: vscode.WorkspaceFolder) {
        super();
    }

    public getWorkspaceFolder(): vscode.WorkspaceFolder {
        return this.workspaceFolder;
    }

    // Copies the options so the user's config object is never mutated
    protected static normalizeOptions(options: TargetOptionsInterface, defaultPort: number): TargetOptionsInterface {
        const normalized = { ...options };
        normalized.port = normalized.port || defaultPort;
        normalized.dir = normalized.dir || "/";
        if (!normalized.dir.endsWith("/")) {
            normalized.dir += "/";
        }
        normalized.keepaliveIntervalMs = normalized.keepaliveIntervalMs || 10000;
        return normalized;
    }

    // Connect callbacks are queued here instead of attached as listeners, so they can't pile up across attempts
    protected addConnectWaiter(cb: Function, errorCb?: Function): void {
        this.connectWaiters.push({ cb, errorCb });
    }

    protected resolveConnectWaiters(error?: unknown): void {
        const waiters = this.connectWaiters;
        this.connectWaiters = [];
        waiters.forEach((waiter) => {
            try {
                if (error === undefined) {
                    waiter.cb();
                } else {
                    waiter.errorCb?.(error);
                }
            } catch (callbackError) {
                Extension.appendLineToOutputChannel("[ERROR] Connect callback failed: " + callbackError);
            }
        });
    }

    // Names come from the remote server and are joined into local paths
    protected static isSafeRemoteName(name: string): boolean {
        return name !== "" && name !== "." && name !== ".." && !/[\\/]/.test(name);
    }

    protected static isRemoteRoot(remotePath: string): boolean {
        return remotePath.replace(/\/+$/, "") === "";
    }

    protected async saveDownloaded(destination: vscode.Uri, content: Uint8Array): Promise<void> {
        await vscode.workspace.fs.writeFile(destination, content);

        const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === destination.toString());
        if (document && document.isDirty) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                destination,
                new vscode.Range(0, 0, document.lineCount, 0),
                Buffer.from(content).toString(),
            );
            await vscode.workspace.applyEdit(edit);
            await document.save();
        }
    }
}
