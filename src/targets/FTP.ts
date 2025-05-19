import Client = require("ftp");
import { Extension } from "../extension";
import { QueueTask, TargetInterface, TargetOptionsInterface } from "./Interfaces";
import * as path from "path";
import * as vscode from "vscode";
import { Queue } from "../Queue";
import EventEmitter = require("events");
import { Configs } from "../configs";
import { Targets } from "./Targets";
import { Target } from "./Target";

export class FTP extends Target implements TargetInterface {
    private client = new Client();
    private name: string;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
    private queue: Queue<QueueTask> = new Queue<QueueTask>();
    private creatingDirectories: Map<string, Promise<string>> = new Map([]);

    constructor(private options: TargetOptionsInterface, workspaceFolder: vscode.WorkspaceFolder) {
        super(workspaceFolder);
        this.setMaxListeners(10000);

        this.name = options.name;

        this.queue.concurrency = Configs.getWorkspaceConfigs(workspaceFolder.uri).concurrency ?? 5;
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

        Extension.appendLineToOutputChannel(
            "[INFO][FTP] target is created. Workspace: " + this.getWorkspaceFolder().name + ". Name: " + this.name
        );
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
        if (this.options.dir[this.options.dir.length - 1] !== "/") {
            this.options.dir += "/";
        }
        if (!this.options.transferDataType) {
            this.options.transferDataType = "binary";
        }
        Extension.appendLineToOutputChannel("INFO][FTP] Connecting to: " + this.options.host + ":" + this.options.port);
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
        const relativePath = Targets.getRelativePath(this.options, uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                Extension.appendLineToOutputChannel("[INFO][FTP] Start uploading file: " + relativePath);
                this.client.put(uri.fsPath, this.options.dir + relativePath, (err) => {
                    if (err) {
                        // if (
                        //     err.message.indexOf("No such file") !== -1 ||
                        //     err.message.indexOf("Couldn't open the file or directory") !== -1
                        // ) {
                        Extension.appendLineToOutputChannel(
                            "[ERROR][FTP] Can't upload file: " + uri.path + ". Error: " + err.message
                        );

                        const dir = this.options.dir + path.dirname(relativePath);
                        this.mkdir(dir).then(
                            () => {
                                this.client.put(uri.fsPath, this.options.dir + relativePath, (err) => {
                                    if (err) {
                                        cb(err);
                                        reject(err);
                                        return;
                                    }
                                    cb();
                                    resolve(uri);
                                    Extension.appendLineToOutputChannel(
                                        "[INFO][FTP] File: '" +
                                            relativePath +
                                            "' is uploaded to: '" +
                                            this.options.dir +
                                            relativePath +
                                            "'"
                                    );
                                });
                            },
                            (reason) => {
                                cb(reason);
                                reject(reason);
                            }
                        );
                        return;
                    }

                    Extension.appendLineToOutputChannel(
                        "[INFO][FTP] File: '" +
                            relativePath +
                            "' is uploaded to: '" +
                            this.options.dir +
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
        const relativePath = Targets.getRelativePath(this.options, uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                this.client.delete(this.options.dir + relativePath, (err) => {
                    if (err) {
                        cb(err);
                        reject(err);
                        return;
                    }
                    Extension.appendLineToOutputChannel("[INFO][FTP] File deleted: '" + relativePath);
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
    download(uri: vscode.Uri, destination?: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = Targets.getRelativePath(this.options, uri);

        if (destination === undefined) {
            destination = uri;
        }

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                if (!this.client) {
                    Extension.appendLineToOutputChannel("[ERROR][FTP] FTP client missing");
                    return;
                }
                Extension.appendLineToOutputChannel("[INFO][FTP] Read file: '" + relativePath);
                this.client.get(this.options.dir + relativePath, (err, stream) => {
                    if (err) {
                        cb(err);
                        reject(err);
                        return;
                    }

                    this.stream2buffer(stream).then(
                        (buffer) => {
                            vscode.workspace.fs.writeFile(destination!, buffer).then(
                                () => {
                                    // Check if the file is unsaved in the editor
                                    const unsaveFile = vscode.workspace.textDocuments.find(
                                        (doc) => doc.uri.fsPath === destination?.fsPath
                                    );
                                    if (unsaveFile && unsaveFile.isDirty) {
                                        const edit = new vscode.WorkspaceEdit();
                                        const fullRange = new vscode.Range(0, 0, unsaveFile.lineCount, 0); // Range covering the entire document
                                        edit.replace(uri, fullRange, buffer.toString());
                                        vscode.workspace.applyEdit(edit);
                                        unsaveFile.save();
                                    }
                                    Extension.appendLineToOutputChannel(
                                        "[INFO][FTP] File downloaded: '" + relativePath
                                    );
                                    cb();
                                    resolve(uri);
                                },
                                (reason) => {
                                    cb(reason);
                                    reject(reason);
                                }
                            );
                        },
                        (reason) => {
                            cb(reason);
                            reject(reason);
                        }
                    );
                });
            });
            job.uri = uri;
            job.isFile = true;
            job.action = "download";
            this.queue.push(job);
        });
    }

    stream2buffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const _buf = Array<any>();

            stream.on("data", (chunk) => {
                _buf.push(chunk);
            });
            stream.on("end", () => resolve(Buffer.concat(_buf)));
            stream.on("error", (err) => reject(`error converting stream - ${err}`));
        });
    }

    downloadDir(uri: vscode.Uri): Promise<vscode.Uri> {
        var relativePath = Targets.getRelativePath(this.options, uri);
        if (relativePath === Extension.getActiveWorkspaceFolder()?.uri.path) {
            relativePath = "";
        }

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }
            const job = <QueueTask>((cb) => {
                const readDir = (dir: string): Promise<any> => {
                    return new Promise<any>((readDirResolve, readDirReject) => {
                        Extension.appendLineToOutputChannel("[INFO][FTP] Start read dir: '" + dir);
                        this.client?.list(this.options.dir + dir, (err, list) => {
                            if (err) {
                                Extension.appendLineToOutputChannel(
                                    "[ERROR][FTP] Can't read dir: '" + dir + "'. Error: " + err
                                );
                                cb(err);
                                readDirReject(err);
                                return;
                            }
                            Extension.appendLineToOutputChannel("[INFO][FTP] Dir files: " + list.length);
                            let downloadOrReadPromises: Promise<vscode.Uri>[] = [];

                            list.forEach((item) => {
                                const file = vscode.Uri.file(
                                    Extension.getActiveWorkspaceFolder()?.uri.path + "/" + dir + "/" + item.name
                                );

                                if (item.type === "-") {
                                    downloadOrReadPromises.push(this.download(file));
                                } else if (item.type === "d") {
                                    downloadOrReadPromises.push(readDir(dir + "/" + item.name));
                                }
                            });

                            Promise.all(downloadOrReadPromises).finally(() => {
                                readDirResolve(list);
                            });
                        });
                    });
                };

                readDir(relativePath).finally(() => {
                    cb();
                    resolve(uri);
                    Extension.appendLineToOutputChannel("[INFO][FTP] Dir downloaded: '" + relativePath);
                });
            });
            job.uri = uri;
            job.isFile = true;
            job.action = "downloadDir";
            this.queue.push(job);
        });
    }
    deleteDir(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = Targets.getRelativePath(this.options, uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                this.client.rmdir(this.options.dir + relativePath, true, (err) => {
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
                Extension.appendLineToOutputChannel("[INFO][FTP] The directory is created: " + dir + ".");
                resolve("");
            });
        });

        this.creatingDirectories.set(dir, promise);

        promise.finally(() => {
            this.creatingDirectories.delete(dir);
        });

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
