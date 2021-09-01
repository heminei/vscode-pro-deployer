import Client = require("ftp");
import { Extension } from "../extension";
import { TargetInterface, TargetOptionsInterface } from "./Interfaces";
import * as path from "path";
import * as vscode from "vscode";

export class FTP implements TargetInterface {
    private client = new Client();
    private name: string;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;

    constructor(private options: TargetOptionsInterface) {
        this.name = options.name;
        this.client.setMaxListeners(20);
        this.client.on("greeting", (msg) => {
            Extension.appendLineToOutputChannel("[INFO][FTP] Greeting: " + msg);
        });
        this.client.on("error", (error) => {
            Extension.showErrorMessage("[FTP] " + error);
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
        this.client.on("ready", () => {
            this.isConnected = true;
            this.isConnecting = false;
            Extension.appendLineToOutputChannel("[INFO][FTP] The connection is ready");
        });

        // this.client.status((error, status) => {
        //     console.log("error", error);
        //     console.log("status", status);
        // });
        Extension.appendLineToOutputChannel("[INFO][FTP] target is created");
    }

    connect(cb: Function, errorCb: Function): void {
        if (this.isConnected) {
            cb();
            return;
        }

        /**
         * Must be before isConnecting condition
         */
        this.client.once("ready", () => {
            console.log('this.client.once("ready"');
            cb();
        });
        this.client.once("error", (error: any) => {
            errorCb(error);
        });

        if (this.isConnecting === true) {
            return;
        }
        this.isConnecting = true;

        if (!this.options.port) {
            this.options.port = 21;
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
        let relativePath = vscode.workspace.asRelativePath(uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            this.connect(
                () => {
                    // Extension.appendLineToOutputChannel("INFO][FTP] Uploading file: " + relativePath);
                    this.client.put(uri.fsPath, this.options.dir + "/" + relativePath, (err) => {
                        if (err) {
                            if (err.message.indexOf("No such file or directory") !== -1) {
                                const dir = this.options.dir + "/" + path.dirname(relativePath);
                                Extension.appendLineToOutputChannel(
                                    "[INFO][FTP] Missing directory: " + dir + ". Trying to create the directory..."
                                );
                                this.mkdir(dir).then(
                                    () => {
                                        Extension.appendLineToOutputChannel(
                                            "[INFO][FTP] The directory is created: " + dir + "."
                                        );
                                        this.upload(uri, attempts).then(
                                            (value) => {
                                                resolve(value);
                                            },
                                            (reason) => {
                                                reject(reason);
                                            }
                                        );
                                    },
                                    (reason) => {
                                        reject(reason);
                                    }
                                );
                                return;
                            }
                            if (err.message.indexOf("read ECONNRESET") !== -1 && attempts < 3) {
                                this.upload(uri, attempts + 1).then(
                                    (value) => {
                                        resolve(value);
                                    },
                                    (reason) => {
                                        reject(reason);
                                    }
                                );
                                return;
                            }
                            Extension.appendLineToOutputChannel(
                                "[ERROR][FTP] Can't upload file: " + uri.path + ". Error: " + err.message
                            );
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
                        // setTimeout(() => {
                        resolve(uri);
                        // }, 100);
                    });
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
            this.client.delete(this.options.dir + "/" + relativePath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(uri);
            });
        });
    }
    deleteDir(uri: vscode.Uri): Promise<vscode.Uri> {
        const relativePath = vscode.workspace.asRelativePath(uri);

        return new Promise<vscode.Uri>((resolve, reject) => {
            this.client.rmdir(this.options.dir + "/" + relativePath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(uri);
            });
        });
    }
    mkdir(path: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this.client.mkdir(path, true, (err) => {
                if (err) {
                    Extension.appendLineToOutputChannel(
                        "[ERROR][FTP] Can't make directory: " + path + ". Error: " + err.message
                    );
                    reject(err.message);
                    return;
                }
                resolve("");
            });
        });
    }

    getName(): string {
        return this.name;
    }

    destroy() {
        if (this.isConnected) {
            this.client.destroy();
            Extension.appendLineToOutputChannel("[INFO][FTP] The connection is destroyed");
        }
    }
}
