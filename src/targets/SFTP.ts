import { Extension } from "../extension";
import { QueueTask, TargetInterface, TargetOptionsInterface } from "./Interfaces";
import * as path from "path";
import * as vscode from "vscode";
import ssh2 = require("ssh2");
import { Queue } from "../Queue";
import { Configs } from "../configs";
import EventEmitter = require("events");

export class SFTP extends EventEmitter implements TargetInterface {
    private client = new ssh2.Client();
    private sftp: ssh2.SFTPWrapper | null = null;
    private name: string;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
    private queue: Queue<QueueTask> = new Queue<QueueTask>();
    private creatingDirectories: Map<string, Promise<string>> = new Map([]);

    constructor(private options: TargetOptionsInterface) {
        super();
        this.setMaxListeners(10000);

        this.name = options.name;

        this.queue.concurrency = Configs.getConfigs().concurrency ?? 5;
        this.queue.autostart = true;
        this.queue.setMaxListeners(10000);

        this.client.setMaxListeners(10000);
        this.client.on("error", (error: any) => {
            Extension.appendLineToOutputChannel("[ERROR][SFTP] " + error);
        });
        this.client.on("close", () => {
            this.isConnected = false;
            this.isConnecting = false;
            Extension.appendLineToOutputChannel("[INFO][SFTP] The connection is closed");
        });
        this.client.on("end", () => {
            this.isConnected = false;
            this.isConnecting = false;
            Extension.appendLineToOutputChannel("[INFO][SFTP] The connection is ended");
        });
        Extension.appendLineToOutputChannel("[INFO][SFTP] target is created");
    }

    connect(cb: Function, errorCb: Function): void {
        if (this.isConnected) {
            cb();
            return;
        }

        this.once("ready", () => {
            cb();
            Extension.appendLineToOutputChannel("[INFO][SFTP] Connected successfully to: " + this.options.host);
        });
        this.once("error", (error) => {
            errorCb(error);
        });

        if (this.isConnecting === true) {
            return;
        }
        this.isConnecting = true;

        this.client.once("ready", () => {
            this.client.sftp((err: any, sftpClient: ssh2.SFTPWrapper) => {
                if (!err) {
                    this.sftp = sftpClient;

                    this.isConnected = true;
                    this.isConnecting = false;
                    this.emit("ready", this);
                } else {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] Can't convert ssh2 to sftp");
                }
            });
        });
        this.client.once("error", (error: any) => {
            this.isConnected = false;
            this.isConnecting = false;
            this.emit("error", error);
            errorCb(error);
        });

        if (!this.options.port) {
            this.options.port = 22;
        }

        let privateKey = undefined;
        try {
            privateKey = this.options.privateKey ? require("fs").readFileSync(this.options.privateKey) : undefined;
        } catch (err) {
            Extension.showErrorMessage("[SFTP] Can't read private key file: " + this.options.privateKey);
            return;
        }

        Extension.appendLineToOutputChannel("[INFO][SFTP] Connecting to: " + this.options.host);
        this.client.connect({
            host: this.options.host,
            port: this.options.port,
            username: this.options.user,
            password: this.options.password,
            privateKey: privateKey,
            passphrase: this.options.passphrase,
        });

        if (Configs.getConfigs().enableStatusBarItem) {
            let hasErrors = false;
            let statusBarCheckTimer: NodeJS.Timeout | undefined = undefined;
            this.queue.on("start", () => {
                Extension.statusBarItem!.text = "$(sync~spin) PRO Deployer: Uploading...";
                statusBarCheckTimer = setInterval(() => {
                    Extension.statusBarItem!.text =
                        "$(sync~spin) PRO Deployer: Uploading (" + (this.queue.getPendingTasks().length + 1) + ")...";
                }, 1000);
            });
            this.queue.on("end", () => {
                if (hasErrors) {
                    Extension.statusBarItem!.text = "$(extensions-warning-message) PRO Deployer";
                    Extension.statusBarItem!.tooltip = "Has some errors, click to see the output channel";
                } else {
                    Extension.statusBarItem!.text = "$(sync) PRO Deployer";
                    Extension.statusBarItem!.tooltip = "";
                }
                if (statusBarCheckTimer) {
                    clearInterval(statusBarCheckTimer);
                }
            });
            this.queue.on("task.success", (job: QueueTask) => {
                Extension.statusBarItem!.tooltip =
                    job.action[0].toUpperCase() +
                    job.action.slice(1) +
                    " (" +
                    (this.queue.getPendingTasks().length + 1) +
                    " pending) => " +
                    vscode.workspace.asRelativePath(job.uri);
            });
            this.queue.on("task.error", (job: QueueTask) => {
                hasErrors = true;
            });
        }

        if (Configs.getConfigs().enableQuickPick) {
            this.queue.on("start", () => {
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: this.name,
                        cancellable: true,
                    },
                    (progress, token) => {
                        token.onCancellationRequested(() => {
                            this.queue.end();
                        });
                        return new Promise<boolean>((resolve, reject) => {
                            const onStartCallback = (job: QueueTask) => {
                                progress.report({
                                    message:
                                        job.action[0].toUpperCase() +
                                        job.action.slice(1) +
                                        " (" +
                                        (this.queue.getPendingTasks().length + 1) +
                                        " pending) => " +
                                        vscode.workspace.asRelativePath(job.uri),
                                });
                            };
                            const onErrorCallback = (job: QueueTask) => {
                                progress.report({
                                    message:
                                        job.action[0].toUpperCase() +
                                        job.action.slice(1) +
                                        " (" +
                                        (this.queue.getPendingTasks().length + 1) +
                                        " pending) => " +
                                        vscode.workspace.asRelativePath(job.uri),
                                });
                            };
                            this.queue.on("task.success", onStartCallback);
                            this.queue.on("task.error", onErrorCallback);
                            this.queue.once("end", () => {
                                this.queue.off("task.success", onStartCallback);
                                this.queue.off("task.error", onErrorCallback);
                                setTimeout(() => {
                                    resolve(true);
                                }, 500);
                            });
                        });
                    }
                );
            });
        }
    }
    upload(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = vscode.workspace.asRelativePath(uri);
        return new Promise<vscode.Uri>((resolve, reject) => {
            this.connect(
                () => {
                    const job = <QueueTask>((cb) => {
                        if (!this.sftp) {
                            Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                            reject("SFTP client missing");
                            return;
                        }
                        Extension.appendLineToOutputChannel("[INFO][SFTP] Start uploading file: " + relativePath);
                        this.sftp.fastPut(uri.fsPath, this.options.dir + "/" + relativePath, (err: any) => {
                            if (err) {
                                if (err.message.indexOf("No such file") !== -1) {
                                    const dir = this.options.dir + "/" + path.dirname(relativePath);

                                    Extension.appendLineToOutputChannel("[INFO][SFTP] Missing directory: " + dir);
                                    this.mkdir(dir).then(
                                        () => {
                                            Extension.appendLineToOutputChannel(
                                                "[INFO][SFTP] The directory is created: " + dir + "."
                                            );
                                            this.sftp?.fastPut(
                                                uri.fsPath,
                                                this.options.dir + "/" + relativePath,
                                                (err: any) => {
                                                    if (err) {
                                                        cb(err);
                                                        reject(err);
                                                        return;
                                                    }
                                                    cb();
                                                    resolve(uri);
                                                }
                                            );
                                        },
                                        (reason: Error) => {
                                            cb(reason);
                                            reject(reason);
                                        }
                                    );
                                    return;
                                }

                                Extension.appendLineToOutputChannel(
                                    "[ERROR][SFTP] Can't upload file: " + uri.path + ". Error: " + err.message
                                );
                                cb(err.message);
                                reject(err.message);
                                return;
                            }
                            Extension.appendLineToOutputChannel(
                                "[INFO][SFTP] File: '" +
                                    relativePath +
                                    "' is uploaded to: '" +
                                    this.options.dir +
                                    "/" +
                                    relativePath +
                                    "'"
                            );
                            cb();
                            resolve(uri);
                        });
                    });
                    job.uri = uri;
                    job.isFile = true;
                    job.action = "upload";
                    this.queue.push(job);
                },
                (err: any) => {
                    reject(err);
                }
            );
        });
    }
    delete(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = vscode.workspace.asRelativePath(uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            this.connect(
                () => {
                    const job = <QueueTask>((cb) => {
                        if (!this.sftp) {
                            Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                            return;
                        }
                        this.sftp.unlink(this.options.dir + "/" + relativePath, (err) => {
                            if (err) {
                                if (err.message.indexOf("No such file") !== -1) {
                                    Extension.appendLineToOutputChannel(
                                        "[INFO][SFTP] File deleted (No such file): '" +
                                            this.options.dir +
                                            "/" +
                                            relativePath
                                    );
                                    cb();
                                    resolve(uri);
                                    return;
                                }
                                cb(err);
                                reject(err);
                                return;
                            }
                            Extension.appendLineToOutputChannel("[INFO][SFTP] File deleted: '" + relativePath);
                            cb();
                            resolve(uri);
                        });
                    });
                    job.uri = uri;
                    job.isFile = true;
                    job.action = "delete";
                    this.queue.push(job);
                },
                (err: any) => {
                    reject(err);
                }
            );
        });
    }
    deleteDir(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = vscode.workspace.asRelativePath(uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            this.connect(
                () => {
                    const job = <QueueTask>((cb) => {
                        const dir = this.options.dir + "/" + relativePath;
                        if (dir === "/") {
                            cb("Can't delete '/' (root dir)");
                            reject("Can't delete '/' (root dir)");
                            return;
                        }
                        Extension.appendLineToOutputChannel("[INFO][SFTP] Start deleting dir: " + dir);
                        this.client.exec("rm -rf " + dir, (err, channel) => {
                            if (err) {
                                cb(err.message);
                                reject(err.message);
                                return;
                            }
                            cb();
                            resolve(uri);
                        });
                    });
                    job.uri = uri;
                    job.action = "delete";
                    job.isFile = false;
                    this.queue.push(job);
                },
                (err: any) => {
                    reject(err);
                }
            );
        });
    }
    mkdir(dir: string): Promise<string> {
        if (this.creatingDirectories.has(dir)) {
            const promise = this.creatingDirectories.get(dir);
            if (promise) {
                return promise;
            }
        }
        const promise = new Promise<string>((resolve, reject) => {
            Extension.appendLineToOutputChannel("[INFO][SFTP] Try to create dir: " + dir);
            this.sftp?.mkdir(dir, (err: any) => {
                if (err) {
                    if (err.message.indexOf("No such file") !== -1) {
                        this.mkdir(path.dirname(dir)).then(
                            () => {
                                this.sftp?.mkdir(dir, (err: any) => {
                                    if (err) {
                                        this.sftp?.exists(dir, (response) => {
                                            if (!response) {
                                                reject(err);
                                                return;
                                            }
                                            resolve("");
                                        });
                                        return;
                                    }
                                    resolve("");
                                });
                            },
                            (err) => {
                                this.sftp?.exists(dir, (response) => {
                                    if (!response) {
                                        reject(err);
                                        return;
                                    }
                                    resolve("");
                                });
                            }
                        );
                        return;
                    }
                    this.sftp?.exists(dir, (response) => {
                        if (!response) {
                            reject(err);
                            return;
                        }
                        resolve("");
                    });
                    return;
                }
                resolve("");
            });
        });
        promise.finally(() => {
            this.creatingDirectories.delete(dir);
        });
        this.creatingDirectories.set(dir, promise);

        return promise;
    }

    getName(): string {
        return this.name;
    }

    getQueue(): Queue<QueueTask> {
        return this.queue;
    }

    destroy() {
        if (this.isConnected) {
            this.client.end();
            this.queue.end();
            Extension.appendLineToOutputChannel("[INFO][SFTP] The connection is destroyed");
        }
    }
}
