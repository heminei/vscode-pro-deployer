import * as vscode from "vscode";
import { Configs } from "./configs";
import { Targets } from "./targets/Targets";
import fs = require("fs");
import micromatch = require("micromatch");
import parser = require("gitignore-parser");
import { QueueTask } from "./targets/Interfaces";
import { MemFS } from "./fileSystemProvider";

export class Extension {
    public static mode = "prod";
    public static extensionContext: vscode.ExtensionContext;
    public static outputChannel: vscode.OutputChannel | null;
    public static statusBarItem: vscode.StatusBarItem | null;
    private static lastErrorMessageTime: number = 0;

    public static init() {
        Extension.outputChannel = vscode.window.createOutputChannel("PRO Deployer");
        if (this.mode === "dev") {
            Extension.outputChannel.show(true);
        }
        Extension.appendLineToOutputChannel("PRO deployer activated");
    }

    public static getActiveWorkspaceFolderPath(): string | null {
        if (vscode.workspace.workspaceFolders) {
            return vscode.workspace.workspaceFolders[0].uri.path;
        }
        return null;
    }

    public static getLastErrorMessageTime() {
        return Extension.lastErrorMessageTime;
    }

    public static appendLineToOutputChannel(string: string) {
        const date = new Date();
        if (Extension.outputChannel) {
            Extension.outputChannel.appendLine("[" + date.toISOString() + "]" + string);
        }
    }

    public static showErrorMessage(string: string) {
        Extension.appendLineToOutputChannel("[ERROR][showErrorMessage] " + string);
        Extension.lastErrorMessageTime = Date.now();
        return vscode.window.showErrorMessage("[PRO Deployer] " + string, "Show output channel").then((value) => {
            if (value === "Show output channel") {
                vscode.commands.executeCommand("pro-deployer.show-output-channel");
            }
        });
    }

    public static isLikeFile(uri: vscode.Uri): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            vscode.workspace.fs.stat(uri).then(
                (fileStat) => {
                    if (fileStat.type === vscode.FileType.File) {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                },
                (reason) => {
                    let name = uri.toString().split("/").pop();
                    if (!name) {
                        reject("Can't get file or folder name");
                        return;
                    }
                    if (name.split(".").length > 1) {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }
            );
        });
    }

    public static isUriIgnored(uri: vscode.Uri): boolean {
        if (uri.scheme === "git") {
            Extension.appendLineToOutputChannel("File ignored (git): " + vscode.workspace.asRelativePath(uri.path));
            return true;
        }
        if (uri.path === Configs.getConfigFile().path) {
            Extension.appendLineToOutputChannel("File ignored (config file)");
            return true;
        }
        if (micromatch.isMatch(vscode.workspace.asRelativePath(uri.path), Configs.getConfigs().ignore)) {
            Extension.appendLineToOutputChannel(
                "File ignored (ignore option): " + vscode.workspace.asRelativePath(uri.path)
            );
            return true;
        }
        if (Configs.getConfigs().checkGitignore) {
            if (fs.existsSync(Configs.getGitignoreFile().path)) {
                if (
                    parser
                        .compile(fs.readFileSync(Configs.getGitignoreFile().path).toString())
                        .denies(vscode.workspace.asRelativePath(uri.path))
                ) {
                    Extension.appendLineToOutputChannel(
                        "File ignored (.gitignore): " + vscode.workspace.asRelativePath(uri.path)
                    );
                    return true;
                }
            }
        }
        return false;
    }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    Extension.extensionContext = context;

    Extension.init();

    Configs.init(() => {
        Targets.destroyAllTargets();
        Extension.statusBarItem?.dispose();

        Configs.getConfigs().targets?.forEach((targetConfig) => {
            let target = Targets.getTargetInstance(targetConfig);
            if (target) {
                Targets.add(target);
            }
        });

        if (Configs.getConfigs().enableStatusBarItem) {
            Extension.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
            Extension.statusBarItem.text = "$(sync) PRO Deployer";
            Extension.statusBarItem.command = "pro-deployer.show-output-channel";
            Extension.statusBarItem.show();
        }

        let statusBarCheckTimer: NodeJS.Timeout | undefined = undefined;
        let tooltipText = "";
        Targets.getItems().forEach((target) => {
            target.getQueue().on("start", () => {
                if (Configs.getConfigs().enableStatusBarItem) {
                    Extension.statusBarItem!.text = "$(sync~spin) PRO Deployer";

                    if (!statusBarCheckTimer) {
                        statusBarCheckTimer = setInterval(() => {
                            let allPendingTasks = 0;
                            Targets.getActive().forEach((target) => {
                                allPendingTasks += target.getQueue().getPendingTasks().length;
                            });
                            if (allPendingTasks > 1) {
                                Extension.statusBarItem!.text =
                                    "$(sync~spin) PRO Deployer: " + (allPendingTasks + 1) + "...";
                                Extension.statusBarItem!.tooltip = tooltipText;
                            }
                        }, 300);
                    }
                }
                if (Configs.getConfigs().enableQuickPick) {
                    vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: target.getName(),
                            cancellable: true,
                        },
                        (progress, token) => {
                            token.onCancellationRequested(() => {
                                target.getQueue().end();
                            });
                            return new Promise<boolean>((resolve, reject) => {
                                const onStartCallback = (job: QueueTask) => {
                                    progress.report({
                                        message:
                                            job.action[0].toUpperCase() +
                                            job.action.slice(1) +
                                            " (" +
                                            (target.getQueue().getPendingTasks().length + 1) +
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
                                            (target.getQueue().getPendingTasks().length + 1) +
                                            " pending) => " +
                                            vscode.workspace.asRelativePath(job.uri),
                                    });
                                };
                                target.getQueue().on("task.success", onStartCallback);
                                target.getQueue().on("task.error", onErrorCallback);
                                target.getQueue().once("end", () => {
                                    target.getQueue().off("task.success", onStartCallback);
                                    target.getQueue().off("task.error", onErrorCallback);
                                    setTimeout(() => {
                                        resolve(true);
                                    }, 500);
                                });
                            });
                        }
                    );
                }
            });
            target.getQueue().on("end", () => {
                if (Configs.getConfigs().enableStatusBarItem) {
                    let allPendingTasks = 0;
                    Targets.getActive().forEach((target) => {
                        allPendingTasks += target.getQueue().getPendingTasks().length;
                    });

                    if (allPendingTasks === 0) {
                        Extension.statusBarItem!.text = "$(sync) PRO Deployer";
                        Extension.statusBarItem!.tooltip = "";
                        Extension.statusBarItem!.backgroundColor = undefined;
                        if (statusBarCheckTimer) {
                            clearInterval(statusBarCheckTimer);
                            statusBarCheckTimer = undefined;
                        }
                    }
                }
            });
            target.getQueue().on("task.success", (job: QueueTask) => {
                if (Configs.getConfigs().enableStatusBarItem) {
                    Extension.statusBarItem!.backgroundColor = undefined;
                    tooltipText =
                        job.action[0].toUpperCase() +
                        job.action.slice(1) +
                        " (" +
                        (target.getQueue().getPendingTasks().length + 1) +
                        " pending) => " +
                        vscode.workspace.asRelativePath(job.uri);
                }
            });
            target.getQueue().on("task.error", (job: QueueTask, error: string) => {
                if (!Extension.getLastErrorMessageTime() || Date.now() - Extension.getLastErrorMessageTime() >= 1000) {
                    Extension.showErrorMessage(
                        target.getName() +
                            " => Can't " +
                            job.action +
                            " file: " +
                            vscode.workspace.asRelativePath(job.uri) +
                            ". Details: " +
                            error
                    );
                }
                if (Configs.getConfigs().enableStatusBarItem) {
                    Extension.statusBarItem!.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
                    tooltipText =
                        job.action[0].toUpperCase() +
                        job.action.slice(1) +
                        " (" +
                        (target.getQueue().getPendingTasks().length + 1) +
                        " pending) => ERROR: " +
                        vscode.workspace.asRelativePath(job.uri);
                }
            });
        });
    });

    const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");

    fileWatcher.onDidCreate((uri) => {
        // console.log("onDidCreate", uri);
        if (Configs.getConfigs().uploadOnSave === false) {
            return;
        }
        if (Extension.isUriIgnored(uri)) {
            return;
        }
        Targets.getActive().forEach((target) => {
            target.connect(() => {
                Extension.isLikeFile(uri).then((isFile) => {
                    if (isFile) {
                        target.upload(uri);
                    } else {
                        vscode.workspace.findFiles(vscode.workspace.asRelativePath(uri) + "/**/*").then((files) => {
                            files.forEach((uri) => {
                                target.upload(uri);
                            });
                        });
                    }
                });
            });
        });
    });
    fileWatcher.onDidChange((uri) => {
        // console.log("onDidChange", uri);
        if (Configs.getConfigs().uploadOnSave === false) {
            return;
        }
        if (Extension.isUriIgnored(uri)) {
            return;
        }
        Targets.getActive().forEach((target) => {
            target.connect(() => {
                Extension.isLikeFile(uri).then((isFile) => {
                    if (isFile) {
                        target.upload(uri);
                    } else {
                        vscode.workspace.findFiles(vscode.workspace.asRelativePath(uri) + "/**/*").then((files) => {
                            files.forEach((uri) => {
                                target.upload(uri);
                            });
                        });
                    }
                });
            });
        });
    });
    fileWatcher.onDidDelete((uri) => {
        // console.log("onDidDelete", uri);
        if (Configs.getConfigs().autoDelete === false) {
            return;
        }
        if (Extension.isUriIgnored(uri)) {
            return;
        }

        Targets.getActive().forEach((target) => {
            target.connect(() => {
                Extension.isLikeFile(uri).then(
                    (isFile) => {
                        if (isFile) {
                            target.delete(uri);
                        } else {
                            target.deleteDir(uri);
                        }
                    },
                    (reason) => {
                        Extension.appendLineToOutputChannel("[ERROR] " + reason);
                    }
                );
            });
        });
    });

    const memFs = new MemFS();
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider("pro-deployer-fs", memFs, { isCaseSensitive: true })
    );

    context.subscriptions.push(fileWatcher);
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.generate-config-file", () => {
            Configs.generateConfigFile();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.show-output-channel", () => {
            Extension.outputChannel?.show(true);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.cancel-all-actions", () => {
            Targets.getItems().forEach((item) => {
                item.getQueue().end();
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload-to", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            if (!thisArg) {
                if (!uri && vscode.window.activeTextEditor?.document.uri) {
                    uri = vscode.window.activeTextEditor?.document.uri;
                }
                if (uri) {
                    thisArg = [uri];
                }
            }
            if (!thisArg) {
                Extension.showErrorMessage("Can't find files for uploading");
                return;
            }

            const items = Targets.getItems().map((item) => {
                return item.getName();
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = Targets.findByName(value);

                target.connect(() => {
                    thisArg.forEach((uri) => {
                        Extension.isLikeFile(uri).then((isFile) => {
                            if (isFile) {
                                target.upload(uri);
                            } else {
                                vscode.workspace
                                    .findFiles(vscode.workspace.asRelativePath(uri) + "/**/*")
                                    .then((files) => {
                                        files.forEach((uri) => {
                                            target.upload(uri);
                                        });
                                    });
                            }
                        });
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            if (!thisArg) {
                if (!uri && vscode.window.activeTextEditor?.document.uri) {
                    uri = vscode.window.activeTextEditor?.document.uri;
                }
                if (uri) {
                    thisArg = [uri];
                }
            }
            if (!thisArg) {
                Extension.showErrorMessage("Can't find files for uploading");
                return;
            }

            if (Targets.getActive().length === 0) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            Targets.getActive().forEach((target) => {
                target.connect(() => {
                    thisArg.forEach((uri) => {
                        Extension.isLikeFile(uri).then((isFile) => {
                            if (isFile) {
                                target.upload(uri);
                            } else {
                                vscode.workspace
                                    .findFiles(vscode.workspace.asRelativePath(uri) + "/**/*")
                                    .then((files) => {
                                        files.forEach((uri) => {
                                            target.upload(uri);
                                        });
                                    });
                            }
                        });
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload-all-open", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            const files = vscode.workspace.textDocuments.filter((textDocument) => {
                if (textDocument.uri.scheme === "git") {
                    return false;
                }
                if (textDocument.uri.scheme === "output") {
                    return false;
                }
                return true;
            });

            const items = Targets.getItems().map((item) => {
                return item.getName();
            });

            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }
                const target = Targets.findByName(value);

                target.connect(() => {
                    files.forEach((textDocument) => {
                        target.upload(textDocument.uri);
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            if (!thisArg) {
                if (!uri && vscode.window.activeTextEditor?.document.uri) {
                    uri = vscode.window.activeTextEditor?.document.uri;
                }
                if (uri) {
                    thisArg = [uri];
                }
            }
            if (!thisArg) {
                Extension.showErrorMessage("Can't find files for downloading");
                return;
            }
            if (Targets.getActive().length === 0) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            const target = Targets.getActive()[0];

            target.connect(() => {
                thisArg.forEach((uri) => {
                    Extension.isLikeFile(uri).then((isFile) => {
                        if (isFile) {
                            target.download(uri);
                        } else {
                            target.downloadDir(uri);
                        }
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-from", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            if (!thisArg) {
                if (!uri && vscode.window.activeTextEditor?.document.uri) {
                    uri = vscode.window.activeTextEditor?.document.uri;
                }
                if (uri) {
                    thisArg = [uri];
                }
            }
            if (!thisArg) {
                Extension.showErrorMessage("Can't find files for downloading");
                return;
            }

            const items = Targets.getItems().map((item) => {
                return item.getName();
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = Targets.findByName(value);

                target.connect(() => {
                    thisArg.forEach((uri) => {
                        Extension.isLikeFile(uri).then((isFile) => {
                            if (isFile) {
                                target.download(uri);
                            } else {
                                target.downloadDir(uri);
                            }
                        });
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-all-files", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            const workspaceFolderPath = Extension.getActiveWorkspaceFolderPath();

            if (!workspaceFolderPath) {
                Extension.showErrorMessage("Can't find workspace folder");
                return;
            }

            const workspaceFolderPathUri = vscode.Uri.file(workspaceFolderPath);

            const items = Targets.getItems().map((item) => {
                return item.getName();
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = Targets.findByName(value);

                target.connect(() => {
                    target.downloadDir(workspaceFolderPathUri);
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.diff-with", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            const workspaceFolderPath = Extension.getActiveWorkspaceFolderPath();

            if (!workspaceFolderPath) {
                Extension.showErrorMessage("Can't find workspace folder");
                return;
            }

            const items = Targets.getItems().map((item) => {
                return item.getName();
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = Targets.findByName(value);

                target.connect(() => {
                    Extension.isLikeFile(uri).then((isFile) => {
                        if (isFile) {
                            let destination = vscode.Uri.parse(
                                "pro-deployer-fs:/" + vscode.workspace.asRelativePath(uri)
                            );
                            target.download(uri, destination).then(() => {
                                vscode.commands.executeCommand("vscode.diff", destination, uri);
                            });
                        } else {
                            Extension.showErrorMessage("Can't diff directory");
                        }
                    });
                });
            });
        })
    );
}

// this method is called when your extension is deactivated
export function deactivate() {
    Targets.destroyAllTargets();
    if (Extension.outputChannel) {
        Extension.outputChannel.dispose();
    }
    if (Extension.statusBarItem) {
        Extension.statusBarItem.dispose();
    }
}
