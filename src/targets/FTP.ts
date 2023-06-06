import Client = require("ftp");
import { Extension } from "../extension";
import { QueueTask, TargetInterface, TargetOptionsInterface } from "./Interfaces";
import * as path from "path";
import * as vscode from "vscode";
import { Queue } from "../Queue";
import EventEmitter = require("events");
import { Configs } from "../configs";

export class FTP extends EventEmitter implements TargetInterface {
    private client = new Client();
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
        this.client.on("greeting", (msg) => {
            Extension.appendLineToOutputChannel("[INFO][FTP] Greeting: " + msg);
        });
        this.client.on("error", (error) => {
            Extension.showErrorMessage("[ERROR][FTP] " + error);
        });
        this.client.on("close", () => {
            this.isConnected = false;
            this.isConnecting = false;
            Extension.appendLineToOutputChannel("[INFO][FTP] The connection is closed");
        });
        this.client.on("end", () => {
            this.isConnected = false;
            this.isConnecting = false;
            Extension.appendLineToOutputChannel("[INFO][FTP] The connection is ended");
        });

        Extension.appendLineToOutputChannel("[INFO][FTP] target is created");
    }

    connect(cb: Function, errorCb: Function | undefined = undefined): void {
        if (this.isConnected) {
            cb();
            return;
        }

        this.once("ready", () => {
            if (this.options.transferDataType === "ascii") {
                this.client.ascii((err) => {
                    if (err) {
                        if (errorCb) {
                            errorCb(err);
                        }
                        return;
                    }
                    cb();
                    Extension.appendLineToOutputChannel("[INFO][FTP] Connected successfully to: " + this.options.host);
                    Extension.appendLineToOutputChannel("[INFO][FTP] Set transfer data type to: ascii");
                });
            } else {
                cb();
                Extension.appendLineToOutputChannel("[INFO][FTP] Connected successfully to: " + this.options.host);
            }
        });
        this.once("error", (error) => {
            if (errorCb) {
                errorCb(error);
            }
        });

        if (this.isConnecting === true) {
            return;
        }
        this.isConnecting = true;

        this.client.once("ready", () => {
            this.isConnected = true;
            this.isConnecting = false;
            this.emit("ready", this);
        });
        this.client.once("error", (error: any) => {
            this.isConnected = false;
            this.isConnecting = false;
            this.emit("error", error);
        });

        if (!this.options.port) {
            this.options.port = 21;
        }
        if (!this.options.transferDataType) {
            this.options.transferDataType = "binary";
        }
        Extension.appendLineToOutputChannel("INFO][FTP] Connecting to: " + this.options.host);
        this.client.connect({
            host: this.options.host,
            port: this.options.port,
            user: this.options.user,
            password: this.options.password,
            secure: this.options.secure,
            // debug: (message) => {
            //     console.log("debug", message);
            // },
            secureOptions: {
                rejectUnauthorized: false,
            },
        });
    }
    upload(uri: vscode.Uri, attempts = 1): Promise<vscode.Uri> {
        const relativePath = vscode.workspace.asRelativePath(uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                Extension.appendLineToOutputChannel("[INFO][FTP] Start uploading file: " + relativePath);
                this.client.put(uri.fsPath, this.options.dir + "/" + relativePath, (err) => {
                    if (err) {
                        if (err.message.indexOf("No such file") !== -1) {
                            const dir = this.options.dir + "/" + path.dirname(relativePath);
                            Extension.appendLineToOutputChannel("[INFO][FTP] Missing directory: " + dir);
                            this.mkdir(dir).then(
                                () => {
                                    Extension.appendLineToOutputChannel(
                                        "[INFO][FTP] The directory is created: " + dir + "."
                                    );
                                    this.client.put(uri.fsPath, this.options.dir + "/" + relativePath, (err) => {
                                        if (err) {
                                            cb(err);
                                            reject(err);
                                            return;
                                        }
                                        cb();
                                        resolve(uri);
                                    });
                                },
                                (reason) => {
                                    cb(reason);
                                    reject(reason);
                                }
                            );
                            return;
                        }
                        // if (err.message.indexOf("read ECONNRESET") !== -1 && attempts < 3) {
                        //     this.upload(uri, attempts + 1).then(
                        //         (value) => {
                        //             resolve(value);
                        //         },
                        //         (reason) => {
                        //             reject(reason);
                        //         }
                        //     );
                        //     return;
                        // }
                        Extension.appendLineToOutputChannel(
                            "[ERROR][FTP] Can't upload file: " + uri.path + ". Error: " + err.message
                        );
                        cb(err.message);
                        reject(err.message);
                        return;
                    }
                    Extension.appendLineToOutputChannel(
                        "[INFO][FTP] File: '" +
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
        });
    }
    delete(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = vscode.workspace.asRelativePath(uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                this.client.delete(this.options.dir + "/" + relativePath, (err) => {
                    if (err) {
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
        });
    }
    deleteDir(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = vscode.workspace.asRelativePath(uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                this.client.rmdir(this.options.dir + "/" + relativePath, (err) => {
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
            Extension.appendLineToOutputChannel("[INFO][FTP] Try to create dir: " + dir);
            this.client.mkdir(dir, true, (err) => {
                if (err) {
                    Extension.appendLineToOutputChannel(
                        "[ERROR][FTP] Can't make directory: " + dir + ". Error: " + err.message
                    );
                    reject(err.message);
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
            this.client.destroy();
            this.queue.end();
            Extension.appendLineToOutputChannel("[INFO][FTP] The connection is destroyed");
        }
    }
}
