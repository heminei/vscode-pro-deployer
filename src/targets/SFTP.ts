import { Extension } from "../extension";
import { QueueTask, TargetInterface, TargetOptionsInterface } from "./Interfaces";
import * as path from "path";
import * as vscode from "vscode";
import ssh2 = require("ssh2");
import { Queue } from "../Queue";
import { Configs } from "../configs";
import EventEmitter = require("events");
import { Targets } from "./Targets";
import { Target } from "./Target";

export class SFTP extends Target implements TargetInterface {
    private client = new ssh2.Client();
    private sftp: ssh2.SFTPWrapper | null = null;
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
            cb();
            Extension.appendLineToOutputChannel("[INFO][SFTP] Connected successfully to: " + this.options.host);
        });
        this.once("error", (error) => {
            Extension.showErrorMessage("Can't connect to " + this.getName() + ": " + error);
            if (errorCb) {
                errorCb(error);
            }
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
        });

        if (!this.options.port) {
            this.options.port = 22;
        }
        if (this.options.dir[this.options.dir.length - 1] !== "/") {
            this.options.dir += "/";
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
    }
    upload(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = Targets.getRelativePath(this.options, uri);
        return new Promise<vscode.Uri>((resolve, reject) => {
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }

            const job = <QueueTask>((cb) => {
                if (!this.sftp) {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                    reject("SFTP client missing");
                    return;
                }
                Extension.appendLineToOutputChannel("[INFO][SFTP] Start uploading file: " + relativePath);
                this.sftp.fastPut(uri.fsPath, this.options.dir + relativePath, (err: any) => {
                    if (err) {
                        if (err.code === 2) {
                            // No such file or directory
                            const dir = this.options.dir + path.dirname(relativePath);

                            Extension.appendLineToOutputChannel("[INFO][SFTP] Missing directory: " + dir + err.code);
                            this.mkdir(dir).then(
                                () => {
                                    Extension.appendLineToOutputChannel(
                                        "[INFO][SFTP] The directory is created: " + dir + "."
                                    );
                                    this.sftp?.fastPut(uri.fsPath, this.options.dir + relativePath, (err: any) => {
                                        if (err) {
                                            cb(err);
                                            reject(err);
                                            return;
                                        }
                                        cb();
                                        resolve(uri);
                                    });
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
                if (!this.sftp) {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                    return;
                }
                this.sftp.unlink(this.options.dir + relativePath, (err: any) => {
                    if (err) {
                        if (err.code === 2) {
                            Extension.appendLineToOutputChannel(
                                "[INFO][SFTP] File deleted (No such file): '" + this.options.dir + relativePath
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
                if (!this.sftp) {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                    return;
                }
                Extension.appendLineToOutputChannel("[INFO][SFTP] Read file: '" + relativePath);
                this.sftp.readFile(this.options.dir + relativePath, {}, (err, handle) => {
                    if (err) {
                        cb(err);
                        reject(err);
                        return;
                    }
                    vscode.workspace.fs.writeFile(destination!, handle).then(
                        () => {
                            Extension.appendLineToOutputChannel("[INFO][SFTP] File downloaded: '" + relativePath);
                            cb();
                            resolve(uri);
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
                        Extension.appendLineToOutputChannel("[INFO][SFTP] Start read dir: '" + dir);
                        this.sftp?.readdir(this.options.dir + dir, (err, list) => {
                            if (err) {
                                Extension.appendLineToOutputChannel(
                                    "[ERROR][SFTP] Can't read dir: '" + dir + "'. Error: " + err
                                );
                                cb(err);
                                readDirReject(err);
                                return;
                            }
                            Extension.appendLineToOutputChannel("[INFO][SFTP] Dir files: " + list.length);
                            let statPromises: Promise<vscode.Uri>[] = [];

                            list.forEach((item) => {
                                statPromises.push(
                                    new Promise<vscode.Uri>((statResolve, statReject) => {
                                        const file = vscode.Uri.file(
                                            Extension.getActiveWorkspaceFolder()?.uri.path +
                                                "/" +
                                                dir +
                                                "/" +
                                                item.filename
                                        );
                                        this.sftp?.stat(this.options.dir + dir + "/" + item.filename, (err, stats) => {
                                            if (err) {
                                                Extension.appendLineToOutputChannel(
                                                    "[ERROR][SFTP] Can't get stat for: '" +
                                                        this.options.dir +
                                                        dir +
                                                        "/" +
                                                        item.filename +
                                                        "'. Error: " +
                                                        err
                                                );
                                                statReject(err);
                                                return;
                                            }

                                            let downloadOrReadPromise: Promise<any> | undefined = undefined;

                                            if (stats.isFile()) {
                                                downloadOrReadPromise = this.download(file);
                                            } else if (stats.isDirectory()) {
                                                downloadOrReadPromise = readDir(dir + "/" + item.filename);
                                            }
                                            if (!downloadOrReadPromise) {
                                                statReject("Unknown file type");
                                                return;
                                            }
                                            downloadOrReadPromise.finally(() => {
                                                statResolve(file);
                                            });
                                        });
                                    })
                                );
                            });

                            Promise.all(statPromises).finally(() => {
                                cb();
                                readDirResolve(list);
                            });
                        });
                    });
                };

                readDir(relativePath).finally(() => {
                    resolve(uri);
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Dir downloaded: '" + relativePath);
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
                const dir = this.options.dir + relativePath;
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
            if (!this.isConnected) {
                reject("Not connected");
                return;
            }
            if (!this.sftp) {
                Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                reject("SFTP client missing");
                return;
            }
            Extension.appendLineToOutputChannel("[INFO][SFTP] Try to create dir: " + dir);
            this.sftp.mkdir(dir, (err: any) => {
                if (err) {
                    if (err.code === 2) {
                        // No such file or directory
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
