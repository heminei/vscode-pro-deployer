import { Extension } from "../extension";
import { QueueTask, RemoteDirEntry, TargetInterface, TargetOptionsInterface } from "./Interfaces";
import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import ssh2 = require("ssh2");
import { Queue } from "../Queue";
import { Configs } from "../configs";
import { Target } from "./Target";
import { Targets } from "./Targets";

export class SFTP extends Target implements TargetInterface {
    private client = new ssh2.Client();
    private sftp: ssh2.SFTPWrapper | null = null;
    private name: string;
    private options: TargetOptionsInterface;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
    private queue: Queue<QueueTask> = new Queue<QueueTask>();
    private creatingDirectories: Map<string, Promise<string>> = new Map([]);

    constructor(options: TargetOptionsInterface, workspaceFolder: vscode.WorkspaceFolder) {
        super(workspaceFolder);
        this.options = Target.normalizeOptions(options, 22);

        this.name = options.name;

        this.queue.concurrency = Configs.getWorkspaceConfigs(workspaceFolder.uri).concurrency ?? 5;
        this.queue.autostart = true;
        this.queue.setMaxListeners(10000);

        // Registered once here; connect() only starts the attempt
        this.client.on("error", (error: any) => {
            Extension.appendLineToOutputChannel("[ERROR][SFTP] " + error);
            this.failConnect(error);
        });
        this.client.on("close", () => this.onDisconnected("closed"));
        this.client.on("end", () => this.onDisconnected("ended"));
        this.client.on("ready", () => {
            this.client.sftp((err: any, sftpClient: ssh2.SFTPWrapper) => {
                if (err) {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] Can't convert ssh2 to sftp");
                    this.failConnect(err);
                    this.client.end();
                    return;
                }
                this.sftp = sftpClient;
                this.isConnected = true;
                this.isConnecting = false;
                Extension.appendLineToOutputChannel("[INFO][SFTP] Connected successfully to: " + this.options.host);
                this.resolveConnectWaiters();
            });
        });
        this.client.on("keyboard-interactive", (name, instructions, instructionsLang, prompts, finish) => {
            Extension.appendLineToOutputChannel("[INFO][SFTP] Server requested keyboard-interactive authentication");
            if (name) {
                Extension.appendLineToOutputChannel("[INFO][SFTP] Keyboard-interactive name: " + name);
            }
            if (instructions) {
                Extension.appendLineToOutputChannel("[INFO][SFTP] Keyboard-interactive instructions: " + instructions);
            }
            prompts.forEach((prompt, index) => {
                Extension.appendLineToOutputChannel(
                    "[INFO][SFTP] Prompt " + index + ": " + prompt.prompt + " (echo: " + prompt.echo + ")",
                );
            });

            const responses: string[] = prompts.map((prompt) => {
                if (prompt.prompt.toLowerCase().includes("password") && this.options.password) {
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Responding to password prompt");
                    return this.options.password;
                }
                Extension.appendLineToOutputChannel(
                    "[WARN][SFTP] Unknown prompt, sending empty response: " + prompt.prompt,
                );
                return "";
            });

            finish(responses);
        });
        Extension.appendLineToOutputChannel(
            "[INFO][SFTP] target is created. Workspace: " + this.getWorkspaceFolder().name + ". Name: " + this.name,
        );
    }

    // A failure is only surfaced while an attempt is in progress; later errors are just logged
    private failConnect(error: any): void {
        const wasConnecting = this.isConnecting;
        this.isConnected = false;
        this.isConnecting = false;
        if (wasConnecting) {
            Extension.showErrorMessage("Can't connect to " + this.getName() + ": " + error);
            this.resolveConnectWaiters(error ?? "Unknown error");
        }
    }

    private onDisconnected(what: string): void {
        this.failConnect("The connection was " + what);
        this.isConnected = false;
        this.sftp = null;
        Extension.appendLineToOutputChannel("[INFO][SFTP] The connection is " + what);
    }

    private verifyHostKey(hexHash: string, expected: string): boolean {
        const base64 = Buffer.from(hexHash, "hex").toString("base64").replace(/=+$/, "");
        const given = expected.trim().replace(/^SHA256:/i, "");
        const matches =
            given.replace(/:/g, "").toLowerCase() === hexHash.toLowerCase() || given.replace(/=+$/, "") === base64;
        if (!matches) {
            Extension.appendLineToOutputChannel(
                "[ERROR][SFTP] Host key fingerprint mismatch. Expected: " + expected + ". Actual: SHA256:" + base64,
            );
        }
        return matches;
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

        let privateKey: Buffer | undefined = undefined;
        try {
            privateKey = this.options.privateKey ? fs.readFileSync(this.options.privateKey) : undefined;
            if (privateKey) {
                Extension.appendLineToOutputChannel("[INFO][SFTP] Private key loaded from: " + this.options.privateKey);
                Extension.appendLineToOutputChannel("[INFO][SFTP] Private key size: " + privateKey.length + " bytes");
                // Check key format
                const keyStr = privateKey.toString();
                if (keyStr.includes("OPENSSH PRIVATE KEY")) {
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Private key format: OpenSSH (new format)");
                } else if (keyStr.includes("RSA PRIVATE KEY")) {
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Private key format: PEM (RSA)");
                } else if (keyStr.includes("DSA PRIVATE KEY")) {
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Private key format: PEM (DSA)");
                } else if (keyStr.includes("EC PRIVATE KEY")) {
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Private key format: PEM (ECDSA)");
                } else if (keyStr.includes("PRIVATE KEY")) {
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Private key format: PEM (PKCS8)");
                } else {
                    Extension.appendLineToOutputChannel("[WARN][SFTP] Private key format: Unknown");
                }
                if (keyStr.includes("ENCRYPTED")) {
                    Extension.appendLineToOutputChannel("[INFO][SFTP] Private key is encrypted (passphrase required)");
                }
            }
        } catch (err: any) {
            Extension.appendLineToOutputChannel(
                "[ERROR][SFTP] Can't read private key file: " + this.options.privateKey + ". Error: " + err.message,
            );
            Extension.showErrorMessage("[SFTP] Can't read private key file: " + this.options.privateKey);
            this.resolveConnectWaiters(err.message ?? "Can't read private key file");
            return;
        }
        this.isConnecting = true;

        // Log authentication configuration
        Extension.appendLineToOutputChannel("[INFO][SFTP] === Authentication Configuration ===");
        Extension.appendLineToOutputChannel("[INFO][SFTP] Username: " + this.options.user);
        Extension.appendLineToOutputChannel(
            "[INFO][SFTP] Password provided: " + (this.options.password ? "Yes" : "No"),
        );
        Extension.appendLineToOutputChannel("[INFO][SFTP] Private key provided: " + (privateKey ? "Yes" : "No"));
        Extension.appendLineToOutputChannel(
            "[INFO][SFTP] Passphrase provided: " + (this.options.passphrase ? "Yes" : "No"),
        );
        Extension.appendLineToOutputChannel(
            "[INFO][SFTP] Connecting to: " + this.options.host + ":" + this.options.port,
        );
        const authAgentPath = this.options.authAgentPath || process.env.SSH_AUTH_SOCK || undefined;
        let useAuthAgent = this.options.useAuthAgent === true;
        if (useAuthAgent && !authAgentPath) {
            Extension.appendLineToOutputChannel("[WARN][SFTP] Auth agent is enabled but no auth agent path is set.");
            useAuthAgent = false;
        }
        Extension.appendLineToOutputChannel(
            "[INFO][SFTP] Auth agent: " + (useAuthAgent ? "Enabled (" + authAgentPath + ")" : "Disabled"),
        );
        const expectedFingerprint = this.options.hostFingerprint;
        if (!expectedFingerprint) {
            Extension.appendLineToOutputChannel(
                "[WARN][SFTP] The host key is not verified. Set hostFingerprint to protect against MITM attacks.",
            );
        }
        try {
            this.client.connect({
                host: this.options.host,
                port: this.options.port,
                username: this.options.user,
                password: this.options.password,
                privateKey: privateKey,
                passphrase: this.options.passphrase,
                tryKeyboard: true, // Enable keyboard-interactive fallback
                agent: useAuthAgent ? authAgentPath : undefined,
                keepaliveInterval: this.options.keepaliveIntervalMs,
                keepaliveCountMax: 3,
                ...(expectedFingerprint
                    ? {
                          hostHash: "sha256" as const,
                          hostVerifier: (hash: string | Buffer) => this.verifyHostKey(String(hash), expectedFingerprint),
                      }
                    : {}),
            });
        } catch (error: any) {
            // ssh2 throws synchronously for unparsable keys
            Extension.appendLineToOutputChannel("[ERROR][SFTP] Can't start the connection: " + error?.message);
            this.failConnect(error?.message ?? error);
        }
    }
    private async setRemoteMtime(uri: vscode.Uri, remotePath: string): Promise<void> {
        if (!this.options.preserveMtime || !this.sftp) {
            return;
        }
        const sftp = this.sftp;
        try {
            const stat = await fs.promises.stat(uri.fsPath);
            await new Promise<void>((resolve, reject) => {
                sftp.utimes(remotePath, Math.floor(stat.atimeMs / 1000), Math.floor(stat.mtimeMs / 1000), (err: any) =>
                    err ? reject(err) : resolve(),
                );
            });
        } catch (error: any) {
            Extension.appendLineToOutputChannel(
                "[WARN][SFTP] Can't preserve modification time of: " + remotePath + ". " + (error?.message ?? error),
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
                if (!this.sftp) {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                    cb("SFTP client missing");
                    reject("SFTP client missing");
                    return;
                }
                Extension.appendLineToOutputChannel("[INFO][SFTP] Start uploading file: " + relativePath);
                this.sftp.fastPut(uri.fsPath, this.options.dir + relativePath, (err: any) => {
                    if (err) {
                        if (err.code === 2) {
                            // No such file or directory
                            const dirName = path.posix.dirname(relativePath);
                            const dir = (this.options.dir + (dirName === "." ? "" : dirName)).replace(/\/+$/, "") || "/";

                            Extension.appendLineToOutputChannel("[INFO][SFTP] Missing directory: " + dir);
                            this.mkdir(dir).then(
                                () => {
                                    Extension.appendLineToOutputChannel(
                                        "[INFO][SFTP] The directory is created: " + dir + ".",
                                    );
                                    this.sftp?.fastPut(uri.fsPath, this.options.dir + relativePath, (err: any) => {
                                        if (err) {
                                            cb(err);
                                            reject(err);
                                            return;
                                        }
                                        this.setRemoteMtime(uri, this.options.dir + relativePath).then(() => {
                                            cb();
                                            resolve(uri);
                                        });
                                    });
                                },
                                (reason: Error) => {
                                    cb(reason);
                                    reject(reason);
                                },
                            );
                            return;
                        }

                        Extension.appendLineToOutputChannel(
                            "[ERROR][SFTP] Can't upload file: " + uri.path + ". Error: " + err.message,
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
                            "'",
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
                if (!this.sftp) {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                    cb("SFTP client missing");
                    reject("SFTP client missing");
                    return;
                }
                this.sftp.unlink(this.options.dir + relativePath, (err: any) => {
                    if (err) {
                        if (err.code === 2) {
                            Extension.appendLineToOutputChannel(
                                "[INFO][SFTP] File deleted (No such file): '" + this.options.dir + relativePath,
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
                Extension.appendLineToOutputChannel("[INFO][SFTP] Skipped ignored file: '" + relativePath);
                resolve(uri);
                return;
            }

            const job = <QueueTask>((cb) => {
                if (!this.sftp) {
                    Extension.appendLineToOutputChannel("[ERROR][SFTP] SFTP client missing");
                    cb("SFTP client missing");
                    reject("SFTP client missing");
                    return;
                }
                Extension.appendLineToOutputChannel("[INFO][SFTP] Read file: '" + relativePath);
                this.sftp.readFile(this.options.dir + relativePath, {}, (err, data) => {
                    if (err) {
                        cb(err);
                        reject(err);
                        return;
                    }
                    this.saveDownloaded(destination!, data).then(
                        () => {
                            Extension.appendLineToOutputChannel("[INFO][SFTP] File downloaded: '" + relativePath);
                            cb();
                            resolve(uri);
                        },
                        (reason) => {
                            cb(reason);
                            reject(reason);
                        },
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
    listDir(remotePath: string): Promise<RemoteDirEntry[]> {
        return new Promise<RemoteDirEntry[]>((resolve, reject) => {
            const sftp = this.sftp;
            if (!this.isConnected || !sftp) {
                reject("Not connected");
                return;
            }
            sftp.readdir(remotePath, (err, list) => {
                if (err) {
                    Extension.appendLineToOutputChannel(
                        "[ERROR][SFTP] Can't list dir: '" + remotePath + "'. Error: " + err,
                    );
                    reject(err);
                    return;
                }
                Promise.all(
                    list.map(
                        (item) =>
                            new Promise<RemoteDirEntry>((statResolve) => {
                                if (!item.attrs.isSymbolicLink()) {
                                    statResolve({ name: item.filename, isDirectory: item.attrs.isDirectory() });
                                    return;
                                }
                                // readdir reports the link itself, so follow it to see if it points to a directory
                                sftp.stat(path.posix.join(remotePath, item.filename), (statErr, stats) => {
                                    statResolve({
                                        name: item.filename,
                                        isDirectory: !statErr && stats.isDirectory(),
                                    });
                                });
                            }),
                    ),
                ).then(resolve, reject);
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
                        const sftp = this.sftp;
                        if (this.queue.generation !== generation) {
                            readDirResolve();
                            return;
                        }
                        if (!sftp) {
                            readDirReject("SFTP client missing");
                            return;
                        }
                        const remoteDir = path.posix.join(this.options.dir || "/", dir);
                        Extension.appendLineToOutputChannel("[INFO][SFTP] Start read dir: '" + dir);
                        sftp.readdir(remoteDir, (err, list) => {
                            if (err) {
                                Extension.appendLineToOutputChannel(
                                    "[ERROR][SFTP] Can't read dir: '" + dir + "'. Error: " + err,
                                );
                                readDirReject(err);
                                return;
                            }
                            if (this.queue.generation !== generation) {
                                readDirResolve();
                                return;
                            }
                            Extension.appendLineToOutputChannel("[INFO][SFTP] Dir files: " + list.length);

                            Promise.all(
                                list
                                    .filter((item) => Target.isSafeRemoteName(item.filename))
                                    .map(
                                        (item) =>
                                            new Promise<void>((entryResolve) => {
                                                const file = vscode.Uri.joinPath(
                                                    workspaceUri,
                                                    baseDir,
                                                    dir,
                                                    item.filename,
                                                );
                                                const remoteFile = path.posix.join(remoteDir, item.filename);
                                                const isLink = item.attrs.isSymbolicLink();
                                                sftp.stat(remoteFile, (statErr, stats) => {
                                                    if (statErr) {
                                                        Extension.appendLineToOutputChannel(
                                                            "[ERROR][SFTP] Can't get stat for: '" +
                                                                remoteFile +
                                                                "'. Error: " +
                                                                statErr,
                                                        );
                                                        entryResolve();
                                                        return;
                                                    }
                                                    if (this.queue.generation !== generation) {
                                                        entryResolve();
                                                        return;
                                                    }
                                                    if (stats.isFile()) {
                                                        // Downloads are separate queue tasks, so this job never waits on its own queue
                                                        downloads.push(
                                                            this.download(file, undefined, checkIgnore).catch(
                                                                () => undefined,
                                                            ),
                                                        );
                                                        entryResolve();
                                                    } else if (stats.isDirectory()) {
                                                        if (isLink) {
                                                            // Following directory links could loop forever
                                                            Extension.appendLineToOutputChannel(
                                                                "[INFO][SFTP] Skipped symlinked dir: '" + remoteFile,
                                                            );
                                                            entryResolve();
                                                            return;
                                                        }
                                                        if (checkIgnore && Extension.isUriIgnored(file, true, true)) {
                                                            Extension.appendLineToOutputChannel(
                                                                "[INFO][SFTP] Skipped ignored dir: '" + remoteFile,
                                                            );
                                                            entryResolve();
                                                            return;
                                                        }
                                                        readDir(dir + "/" + item.filename).then(
                                                            () => entryResolve(),
                                                            () => entryResolve(),
                                                        );
                                                    } else {
                                                        entryResolve();
                                                    }
                                                });
                                            }),
                                    ),
                            ).then(() => readDirResolve());
                        });
                    });
                };

                readDir(relativePath).then(
                    () => {
                        cb();
                        Promise.all(downloads).then(() => {
                            resolve(uri);
                            Extension.appendLineToOutputChannel("[INFO][SFTP] Dir downloaded: '" + relativePath);
                        });
                    },
                    (error) => {
                        cb(error);
                        reject(error);
                    },
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
                const sftp = this.sftp;
                const remoteDir = this.options.dir + relativePath;
                if (Target.isRemoteRoot(remoteDir)) {
                    cb("Can't delete '/' (root dir)");
                    reject("Can't delete '/' (root dir)");
                    return;
                }
                if (!sftp) {
                    cb("SFTP client missing");
                    reject("SFTP client missing");
                    return;
                }
                const dir = remoteDir.replace(/\/+$/, "");
                Extension.appendLineToOutputChannel("[INFO][SFTP] Start deleting dir: " + dir);
                // Done over SFTP instead of `rm -rf`: no shell is involved, so odd file names can't inject commands
                this.removeDir(sftp, dir).then(
                    () => {
                        cb();
                        resolve(uri);
                    },
                    (error: any) => {
                        const message = error?.message ?? String(error);
                        cb(message);
                        reject(message);
                    },
                );
            });
            job.uri = uri;
            job.action = "delete";
            job.isFile = false;
            this.queue.push(job);
        });
    }
    private removeDir(sftp: ssh2.SFTPWrapper, dir: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            sftp.readdir(dir, (err, list) => {
                if (err) {
                    reject(err);
                    return;
                }
                Promise.all(
                    list
                        .filter((item) => Target.isSafeRemoteName(item.filename))
                        .map((item) => {
                            const remote = path.posix.join(dir, item.filename);
                            // readdir attrs describe the link itself, so a symlinked dir is unlinked, never followed
                            if (item.attrs.isDirectory()) {
                                return this.removeDir(sftp, remote);
                            }
                            return new Promise<void>((unlinkResolve, unlinkReject) => {
                                sftp.unlink(remote, (unlinkErr) => (unlinkErr ? unlinkReject(unlinkErr) : unlinkResolve()));
                            });
                        }),
                ).then(() => {
                    sftp.rmdir(dir, (rmdirErr) => (rmdirErr ? reject(rmdirErr) : resolve()));
                }, reject);
            });
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
                        this.mkdir(path.posix.dirname(dir)).then(
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
                            },
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
        const cleanup = () => {
            this.creatingDirectories.delete(dir);
        };
        promise.then(cleanup, cleanup);
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
        // Drop the attempt first so the close event doesn't report a failed connect
        const wasConnecting = this.isConnecting;
        this.isConnecting = false;
        if (wasConnecting) {
            this.resolveConnectWaiters("The target was destroyed");
        }
        this.client.end();
        this.queue.end();
        Extension.appendLineToOutputChannel("[INFO][SFTP] The connection is destroyed");
    }
}
