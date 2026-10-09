import Client = require("ftp");
import { Extension } from "../extension";
import { QueueTask, RemoteDirEntry, TargetInterface, TargetOptionsInterface } from "./Interfaces";
import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { Queue } from "../Queue";
import { Configs } from "../configs";
import { Targets } from "./Targets";
import { Target } from "./Target";

export class FTP extends Target implements TargetInterface {
    private client = new Client();
    private name: string;
    private options: TargetOptionsInterface;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
    private queue: Queue<QueueTask> = new Queue<QueueTask>();
    private creatingDirectories: Map<string, Promise<string>> = new Map([]);
    private mfmtUnsupported: boolean = false;

    constructor(options: TargetOptionsInterface, workspaceFolder: vscode.WorkspaceFolder) {
        super(workspaceFolder);
        this.options = Target.normalizeOptions(options, 21);
        this.options.transferDataType = this.options.transferDataType || "binary";

        this.name = options.name;

        this.queue.concurrency = Configs.getWorkspaceConfigs(workspaceFolder.uri).concurrency ?? 5;
        this.queue.autostart = true;
        this.queue.setMaxListeners(10000);

        // Registered once here; connect() only starts the attempt
        this.client.on("greeting", (msg) => {
            Extension.appendLineToOutputChannel("[INFO][FTP] Greeting: " + msg);
        });
        this.client.on("error", (error) => {
            if (this.isConnecting) {
                this.failConnect(error);
                return;
            }
            Extension.showErrorMessage("[ERROR][FTP] " + error);
        });
        this.client.on("close", () => this.onDisconnected("closed"));
        this.client.on("end", () => this.onDisconnected("ended"));
        this.client.on("ready", () => {
            this.isConnected = true;
            this.isConnecting = false;
            this.mfmtUnsupported = false;
            if (this.options.transferDataType !== "ascii") {
                Extension.appendLineToOutputChannel("[INFO][FTP] Connected successfully to: " + this.options.host);
                this.resolveConnectWaiters();
                return;
            }
            this.client.ascii((err) => {
                if (err) {
                    this.resolveConnectWaiters(err);
                    return;
                }
                Extension.appendLineToOutputChannel("[INFO][FTP] Connected successfully to: " + this.options.host);
                Extension.appendLineToOutputChannel("[INFO][FTP] Set transfer data type to: ascii");
                this.resolveConnectWaiters();
            });
        });

        Extension.appendLineToOutputChannel(
            "[INFO][FTP] target is created. Workspace: " + this.getWorkspaceFolder().name + ". Name: " + this.name
        );
    }

    // A failure is only surfaced while an attempt is in progress
    private failConnect(error: any): void {
        const wasConnecting = this.isConnecting;
        this.isConnected = false;
        this.isConnecting = false;
        if (wasConnecting) {
            Extension.showErrorMessage("[FTP] Can't connect to " + this.getName() + ": " + error);
            this.resolveConnectWaiters(error ?? "Unknown error");
        }
    }

    private onDisconnected(what: string): void {
        this.failConnect("The connection was " + what);
        this.isConnected = false;
        Extension.appendLineToOutputChannel("[INFO][FTP] The connection is " + what);
    }

    connect(cb: Function, errorCb: Function | undefined = undefined): void {
        if (this.isConnected) {
            cb();
            return;
        }

        this.addConnectWaiter(cb, errorCb);

        if (this.isConnecting === true) {
            return;
        }
        this.isConnecting = true;

        Extension.appendLineToOutputChannel(
            "[INFO][FTP] Connecting to: " + this.options.host + ":" + this.options.port
        );
        if (this.options.secure) {
            Extension.appendLineToOutputChannel(
                "[INFO][FTP] Using secure connection (FTPS): " +
                    (this.options.secure === "implicit" ? "implicit" : "explicit")
            );
        }
        const rejectUnauthorized = this.options.secureOptions?.rejectUnauthorized ?? true;
        if (this.options.secure && !rejectUnauthorized) {
            Extension.appendLineToOutputChannel(
                "[WARN][FTP] Certificate validation is disabled (secureOptions.rejectUnauthorized is false)"
            );
        }
        try {
            this.client.connect({
                host: this.options.host,
                port: this.options.port,
                user: this.options.user,
                password: this.options.password,
                secure: this.options.secure,
                keepalive: this.options.keepaliveIntervalMs,
                secureOptions: {
                    rejectUnauthorized,
                },
            });
        } catch (error: any) {
            Extension.appendLineToOutputChannel("[ERROR][FTP] Can't start the connection: " + error?.message);
            this.failConnect(error?.message ?? error);
        }
    }
    private async setRemoteMtime(uri: vscode.Uri, remotePath: string): Promise<void> {
        if (!this.options.preserveMtime || this.mfmtUnsupported) {
            return;
        }
        try {
            const stat = await fs.promises.stat(uri.fsPath);
            const time = stat.mtime
                .toISOString()
                .replace(/\.\d+Z$/, "")
                .replace(/[-:T]/g, "");
            await new Promise<void>((resolve, reject) => {
                // MFMT is not exposed by the ftp library, so it is sent as a raw command
                (this.client as any)._send("MFMT " + time + " " + remotePath, (err: any) =>
                    err ? reject(err) : resolve()
                );
            });
        } catch (error: any) {
            // 500/502/504: the server does not implement MFMT, so stop trying on this connection
            if ([500, 502, 504].includes(error?.code)) {
                this.mfmtUnsupported = true;
                Extension.appendLineToOutputChannel(
                    "[WARN][FTP] Server does not support MFMT, modification times will not be preserved: " +
                        (error?.message ?? error)
                );
                return;
            }
            Extension.appendLineToOutputChannel(
                "[WARN][FTP] Can't preserve modification time of: " + remotePath + ". " + (error?.message ?? error)
            );
        }
    }
    upload(uri: vscode.Uri): Promise<vscode.Uri> {
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
                        // Only a missing parent directory is worth a retry; 450/550/553 are the "file unavailable" replies
                        if (![450, 550, 553].includes((err as any).code)) {
                            Extension.appendLineToOutputChannel(
                                "[ERROR][FTP] Can't upload file: " + uri.path + ". Error: " + err.message
                            );
                            cb(err);
                            reject(err);
                            return;
                        }
                        Extension.appendLineToOutputChannel(
                            "[INFO][FTP] Upload failed (" + err.message + "), trying to create the directory: " + uri.path
                        );

                        const dirName = path.posix.dirname(relativePath);
                        const dir = this.options.dir + (dirName === "." ? "" : dirName);
                        this.mkdir(dir).then(
                            () => {
                                this.client.put(uri.fsPath, this.options.dir + relativePath, (err) => {
                                    if (err) {
                                        cb(err);
                                        reject(err);
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
                                    this.setRemoteMtime(uri, this.options.dir + relativePath).then(() => {
                                        cb();
                                        resolve(uri);
                                    });
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
                    this.setRemoteMtime(uri, this.options.dir + relativePath).then(() => {
                        cb();
                        resolve(uri);
                    });
                });
            });
            job.uri = uri;
            job.isFile = true;
            job.action = "upload";
            this.queue.push(job);
        });
    }
    delete(uri: vscode.Uri, options?: { quiet?: boolean }): Promise<vscode.Uri> {
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
            job.quiet = options?.quiet;
            this.queue.push(job);
        });
    }
    download(uri: vscode.Uri, destination?: vscode.Uri, checkIgnore: boolean = false): Promise<vscode.Uri> {
        const relativePath = Targets.getRelativePath(this.options, uri);

        if (destination === undefined) {
            destination = uri;
        }

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }
            if (checkIgnore && Extension.isUriIgnored(uri, false, true)) {
                Extension.appendLineToOutputChannel("[INFO][FTP] Skipped ignored file: '" + relativePath);
                resolve(uri);
                return;
            }

            const job = <QueueTask>((cb) => {
                Extension.appendLineToOutputChannel("[INFO][FTP] Read file: '" + relativePath);
                this.client.get(this.options.dir + relativePath, (err, stream) => {
                    if (err) {
                        cb(err);
                        reject(err);
                        return;
                    }

                    this.stream2buffer(stream).then(
                        (buffer) => {
                            this.saveDownloaded(destination!, buffer).then(
                                () => {
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
            job.cancel = () => reject("Canceled");
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

    listDir(remotePath: string): Promise<RemoteDirEntry[]> {
        return new Promise<RemoteDirEntry[]>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }
            this.client.list(remotePath, (err, list) => {
                if (err) {
                    Extension.appendLineToOutputChannel(
                        "[ERROR][FTP] Can't list dir: '" + remotePath + "'. Error: " + err
                    );
                    reject(err);
                    return;
                }
                resolve(
                    list
                        .filter((item) => item.name !== "." && item.name !== "..")
                        // FTP can't cheaply resolve symlinks, so they are offered as directories
                        .map((item) => ({ name: item.name, isDirectory: item.type === "d" || item.type === "l" }))
                );
            });
        });
    }

    downloadDir(uri: vscode.Uri, checkIgnore: boolean = false): Promise<vscode.Uri> {
        const relativePath = Targets.getRelativePath(this.options, uri);
        const workspaceUri = this.getWorkspaceFolder().uri;

        // Get baseDir for constructing local paths
        let baseDir = this.options.baseDir ?? "";
        if (baseDir.startsWith("/")) {
            baseDir = baseDir.substring(1);
        }
        if (baseDir.length > 0 && !baseDir.endsWith("/")) {
            baseDir = baseDir + "/";
        }

        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }
            const generation = this.queue.generation;
            const downloads: Promise<unknown>[] = [];
            const job = <QueueTask>((cb) => {
                const readDir = (dir: string): Promise<void> => {
                    return new Promise<void>((readDirResolve, readDirReject) => {
                        if (this.queue.generation !== generation) {
                            readDirResolve();
                            return;
                        }
                        Extension.appendLineToOutputChannel("[INFO][FTP] Start read dir: '" + dir);
                        this.client.list(path.posix.join(this.options.dir || "/", dir), (err, list) => {
                            if (err) {
                                Extension.appendLineToOutputChannel(
                                    "[ERROR][FTP] Can't read dir: '" + dir + "'. Error: " + err
                                );
                                readDirReject(err);
                                return;
                            }
                            if (this.queue.generation !== generation) {
                                readDirResolve();
                                return;
                            }
                            Extension.appendLineToOutputChannel("[INFO][FTP] Dir files: " + list.length);
                            const subDirs: Promise<void>[] = [];

                            list.forEach((item) => {
                                if (!Target.isSafeRemoteName(item.name)) {
                                    return;
                                }
                                const file = vscode.Uri.joinPath(workspaceUri, baseDir, dir, item.name);
                                const isDirectory = item.type === "d";

                                if ((item.type === "-" || isDirectory) && checkIgnore && Extension.isUriIgnored(file, isDirectory, true)) {
                                    Extension.appendLineToOutputChannel(
                                        "[INFO][FTP] Skipped ignored: '" + path.posix.join(dir, item.name)
                                    );
                                    return;
                                }

                                if (item.type === "-") {
                                    // Downloads are separate queue tasks, so this job never waits on its own queue
                                    downloads.push(this.download(file).catch(() => undefined));
                                } else if (isDirectory) {
                                    subDirs.push(readDir(dir + "/" + item.name).catch(() => undefined));
                                }
                            });

                            Promise.all(subDirs).then(() => readDirResolve());
                        });
                    });
                };

                readDir(relativePath).then(
                    () => {
                        cb();
                        Promise.all(downloads).then(() => {
                            resolve(uri);
                            Extension.appendLineToOutputChannel("[INFO][FTP] Dir downloaded: '" + relativePath);
                        });
                    },
                    (error) => {
                        cb(error);
                        reject(error);
                    }
                );
            });
            job.uri = uri;
            job.isFile = true;
            job.action = "downloadDir";
            job.cancel = () => resolve(uri);
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
                const remoteDir = this.options.dir + relativePath;
                if (Target.isRemoteRoot(remoteDir)) {
                    cb("Can't delete '/' (root dir)");
                    reject("Can't delete '/' (root dir)");
                    return;
                }
                this.client.rmdir(remoteDir, true, (err) => {
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

        const cleanup = () => {
            this.creatingDirectories.delete(dir);
        };
        promise.then(cleanup, cleanup);

        return promise;
    }

    getName(): string {
        return this.name;
    }

    getQueue(): Queue<QueueTask> {
        return this.queue;
    }

    destroy() {
        // Drop the attempt first so the close event doesn't report a failed connect
        const wasConnecting = this.isConnecting;
        this.isConnecting = false;
        if (wasConnecting) {
            this.resolveConnectWaiters("The target was destroyed");
        }
        this.client.destroy();
        this.queue.end();
        Extension.appendLineToOutputChannel("[INFO][FTP] The connection is destroyed");
    }
}
