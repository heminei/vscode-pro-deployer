import * as vscode from "vscode";
import { Configs } from "./configs";
import { Targets } from "./targets/Targets";
import { SecretManager } from "./SecretManager";
import fs = require("fs");
import micromatch = require("micromatch");
import parser = require("gitignore-parser");
import { QueueTask } from "./targets/Interfaces";
import { MemFS } from "./fileSystemProvider";
import { RemoteBrowser } from "./RemoteBrowser";
import { DirCodeLensProvider } from "./DirCodeLensProvider";
import { GitExtension, Status } from "./typings/git";

export class Extension {
    public static mode = process.env.APP_MODE ?? "prod";
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

    public static getActiveWorkspaceFolder(): vscode.WorkspaceFolder | null {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const activeDocumentUri = activeEditor.document.uri;
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
            if (workspaceFolder) {
                return workspaceFolder;
            }
        }
        if (vscode.workspace.workspaceFolders) {
            return vscode.workspace.workspaceFolders[0];
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

    // Command args carry this marker when the "filtered" command variants delegate to the base commands.
    public static readonly filterIgnoredArg = { filterIgnored: true };

    public static getDownloadIgnoreMode(args: any[], target: { getWorkspaceFolder(): vscode.WorkspaceFolder }) {
        const explicit = args.some((arg) => arg === Extension.filterIgnoredArg);
        const configured = Configs.getWorkspaceConfigs(target.getWorkspaceFolder().uri)?.respectIgnoreOnDownload === true;
        // A file picked explicitly is only filtered by the explicit command; the config option affects bulk downloads.
        return { forFile: explicit, forDir: explicit || configured };
    }

    public static isUriIgnored(uri: vscode.Uri, isDirectory: boolean = false, quiet: boolean = false): boolean {
        const relativePath = vscode.workspace.asRelativePath(uri.path);
        const log = (message: string) => {
            if (!quiet) {
                Extension.appendLineToOutputChannel(message);
            }
        };

        if (uri.scheme === "git") {
            log("File ignored (git): " + relativePath);
            return true;
        }
        if (uri.path === Configs.getConfigFile().path) {
            log("File ignored (config file)");
            return true;
        }
        const ignorePatterns = Configs.getWorkspaceConfigs(uri).ignore;
        // Patterns like "logs/**/*" only match children, so probe the directory with a fake child.
        if (
            micromatch.isMatch(relativePath, ignorePatterns, { dot: true }) ||
            (isDirectory && micromatch.isMatch(relativePath + "/__dir__", ignorePatterns, { dot: true }))
        ) {
            log("File/folder ignored (ignore option): " + relativePath);
            return true;
        }
        // A directory can't be tested against include patterns (e.g. "src/**/*.ts"), its files are tested instead.
        if (!isDirectory && Configs.getWorkspaceConfigs(uri).include.length > 0) {
            if (micromatch.isMatch(relativePath, Configs.getWorkspaceConfigs(uri).include, { dot: true }) === false) {
                log("File/folder not included (include option): " + relativePath);
                return true;
            }
        }
        if (Configs.getWorkspaceConfigs(uri).checkGitignore) {
            if (fs.existsSync(Configs.getGitignoreFile().path)) {
                if (parser.compile(fs.readFileSync(Configs.getGitignoreFile().path).toString()).denies(relativePath)) {
                    log("File ignored (.gitignore): " + relativePath);
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

        Configs.getAllTargetOptions().forEach((targetOption) => {
            let target = Targets.getTargetInstance(targetOption.options, targetOption.workspaceFolder);
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
        if (Configs.getWorkspaceConfigs(uri).uploadOnSave === false) {
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
                        const includePattern = new vscode.RelativePattern(
                            target.getWorkspaceFolder(),
                            vscode.workspace.asRelativePath(uri, false) + "/**/*"
                        );
                        vscode.workspace.findFiles(includePattern).then((files) => {
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
        if (Configs.getWorkspaceConfigs(uri).uploadOnSave === false) {
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
                        const includePattern = new vscode.RelativePattern(
                            target.getWorkspaceFolder(),
                            vscode.workspace.asRelativePath(uri, false) + "/**/*"
                        );
                        vscode.workspace.findFiles(includePattern).then((files) => {
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
        if (Configs.getWorkspaceConfigs(uri).autoDelete === false) {
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
        vscode.commands.registerCommand("pro-deployer.set-secret", async () => {
            const name = (
                await vscode.window.showInputBox({
                    title: "PRO Deployer: Set Secret",
                    prompt: "Secret name, used in the config as ${secret:name}",
                    validateInput: (value) =>
                        SecretManager.isValidName(value.trim()) ? undefined : "Use a name without spaces, $, { or }",
                })
            )?.trim();
            if (!name) {
                return;
            }
            const value = await vscode.window.showInputBox({
                title: "PRO Deployer: Set Secret",
                prompt: "Value for '" + name + "' (stored in the OS keychain)",
                password: true,
            });
            if (value === undefined) {
                return;
            }
            await SecretManager.set(name, value);
            await Configs.reload();
            vscode.window.showInformationMessage(
                "Secret saved. Use \"password\": \"${secret:" + name + "}\" in the config."
            );
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.delete-secret", async () => {
            const names = SecretManager.getNames();
            if (names.length === 0) {
                vscode.window.showInformationMessage("No secrets are stored.");
                return;
            }
            const name = await vscode.window.showQuickPick(names, { title: "PRO Deployer: Delete Secret" });
            if (!name) {
                return;
            }
            await SecretManager.delete(name);
            await Configs.reload();
            vscode.window.showInformationMessage("Secret '" + name + "' deleted.");
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.show-output-channel", () => {
            Extension.outputChannel?.show(true);
        })
    );
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { scheme: "file", pattern: "**/.vscode/pro-deployer.json" },
            new DirCodeLensProvider()
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.browse-remote-dir", (...args) => {
            const configFile = args[0] instanceof vscode.Uri ? args[0] : undefined;
            const targetIndex = configFile && typeof args[1] === "number" ? args[1] : undefined;
            return RemoteBrowser.run(configFile, targetIndex);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.cancel-all-actions", () => {
            Targets.getItems().forEach((item) => {
                item.getQueue().end();
            });
            vscode.window.showInformationMessage("All actions have been canceled");
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload-to", (...args) => {
            const URIs = [] as vscode.Uri[];
            let targetName: string | undefined;

            args.forEach((arg) => {
                if (arg instanceof vscode.Uri) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg);
                    }
                }
                if ("resourceUri" in arg) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.resourceUri.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg.resourceUri);
                    }
                }
                if (Array.isArray(arg)) {
                    arg.forEach((uri) => {
                        if (uri instanceof vscode.Uri) {
                            const checkExist = URIs.find((item) => {
                                return item.toString() === uri.toString();
                            });
                            if (!checkExist) {
                                URIs.push(uri);
                            }
                        }
                    });
                }
                if (typeof arg === "object" && arg !== null && "target" in arg && typeof arg.target === "string") {
                    targetName = arg.target;
                }
            });
            if (URIs.length === 0 && vscode.window.activeTextEditor?.document.uri) {
                URIs.push(vscode.window.activeTextEditor?.document.uri);
            }
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for uploading");
                return;
            }

            const performUpload = (target: any) => {
                target.connect(() => {
                    URIs.forEach((uri) => {
                        Extension.isLikeFile(uri).then((isFile) => {
                            if (isFile) {
                                target.upload(uri);
                            } else {
                                const includePattern = new vscode.RelativePattern(
                                    target.getWorkspaceFolder(),
                                    vscode.workspace.asRelativePath(uri, false) + "/**/*"
                                );
                                vscode.workspace.findFiles(includePattern).then((files) => {
                                    files.forEach((uri) => {
                                        target.upload(uri);
                                    });
                                });
                            }
                        });
                    });
                });
            };

            const availableTargets = Targets.getItems().filter((item) => {
                if (Extension.getActiveWorkspaceFolder()?.uri.path !== item.getWorkspaceFolder().uri.path) {
                    return false;
                }
                return true;
            });

            if (targetName) {
                const target = availableTargets.find((t) => t.getName() === targetName);
                if (target) {
                    performUpload(target);
                    return;
                } else {
                    Extension.showErrorMessage(`Target '${targetName}' not found in active workspace.`);
                    return;
                }
            }

            const items = availableTargets.map((item) => {
                return {
                    label: item.getName(),
                    description: item.getWorkspaceFolder().name,
                    target: item,
                };
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                performUpload(value.target);
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload", (...args) => {
            const URIs = [] as vscode.Uri[];
            args.forEach((arg) => {
                if (arg instanceof vscode.Uri) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg);
                    }
                }
                if ("resourceUri" in arg) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.resourceUri.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg.resourceUri);
                    }
                }
                if (Array.isArray(arg)) {
                    arg.forEach((uri) => {
                        if (uri instanceof vscode.Uri) {
                            const checkExist = URIs.find((item) => {
                                return item.toString() === uri.toString();
                            });
                            if (!checkExist) {
                                URIs.push(uri);
                            }
                        }
                    });
                }
            });
            if (URIs.length === 0 && vscode.window.activeTextEditor?.document.uri) {
                URIs.push(vscode.window.activeTextEditor?.document.uri);
            }
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for uploading");
                return;
            }

            if (Targets.getActive().length === 0) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            Targets.getActive().forEach((target) => {
                target.connect(() => {
                    URIs.forEach((uri) => {
                        Extension.isLikeFile(uri).then((isFile) => {
                            if (isFile) {
                                target.upload(uri);
                            } else {
                                const includePattern = new vscode.RelativePattern(
                                    target.getWorkspaceFolder(),
                                    vscode.workspace.asRelativePath(uri, false) + "/**/*"
                                );
                                vscode.workspace.findFiles(includePattern).then((files) => {
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
        vscode.commands.registerCommand("pro-deployer.upload-all-open", () => {
            const files = [] as vscode.Uri[];
            vscode.window.tabGroups.all.forEach((tabGroup) => {
                tabGroup.tabs.forEach((tab) => {
                    if (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputNotebook) {
                        files.push(tab.input.uri);
                    }
                    if (
                        tab.input instanceof vscode.TabInputTextDiff ||
                        tab.input instanceof vscode.TabInputNotebookDiff
                    ) {
                        files.push(tab.input.original);
                    }
                });
            });

            const items = Targets.getItems().map((item) => {
                return {
                    label: item.getName(),
                    description: item.getWorkspaceFolder().name,
                    target: item,
                };
            });

            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }
                const target = value.target;

                target.connect(() => {
                    files.forEach((uri) => {
                        if (
                            target.getWorkspaceFolder().uri.path !== vscode.workspace.getWorkspaceFolder(uri)?.uri.path
                        ) {
                            Extension.appendLineToOutputChannel(
                                "[INFO] File ignored, because is not from workspace. File: " + uri.path
                            );
                            return;
                        }
                        target.upload(uri);
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload-all-uncommitted", async (...args) => {
            const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
            if (!gitExtension) {
                vscode.window.showErrorMessage("Git extension is not enabled.");
                return;
            }
            const git = gitExtension.exports.getAPI(1);
            if (!git) {
                vscode.window.showErrorMessage("Git extension is not enabled.");
                return;
            }
            // Get the active repository (if any)
            const repo = git.repositories[0];
            if (!repo) {
                vscode.window.showErrorMessage("No Git repository found.");
                return;
            }
            const URIs = [] as vscode.Uri[];
            repo.state.workingTreeChanges.forEach((change) => {
                if (change.status === Status.DELETED) {
                    return;
                }
                URIs.push(change.uri);
            });

            const items = Targets.getItems().map((item) => {
                return {
                    label: item.getName(),
                    description: item.getWorkspaceFolder().name,
                    target: item,
                };
            });

            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }
                const target = value.target;

                target.connect(() => {
                    URIs.forEach((uri) => {
                        if (Extension.isUriIgnored(uri)) {
                            return;
                        }
                        if (
                            target.getWorkspaceFolder().uri.path !== vscode.workspace.getWorkspaceFolder(uri)?.uri.path
                        ) {
                            Extension.appendLineToOutputChannel(
                                "[INFO] File ignored, because is not from workspace. File: " + uri.path
                            );
                            return;
                        }
                        target.upload(uri);
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download", (...args) => {
            const URIs = [] as vscode.Uri[];
            args.forEach((arg) => {
                if (arg instanceof vscode.Uri) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg);
                    }
                }
                if ("resourceUri" in arg) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.resourceUri.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg.resourceUri);
                    }
                }
                if (Array.isArray(arg)) {
                    arg.forEach((uri) => {
                        if (uri instanceof vscode.Uri) {
                            const checkExist = URIs.find((item) => {
                                return item.toString() === uri.toString();
                            });
                            if (!checkExist) {
                                URIs.push(uri);
                            }
                        }
                    });
                }
            });
            if (URIs.length === 0 && vscode.window.activeTextEditor?.document.uri) {
                URIs.push(vscode.window.activeTextEditor?.document.uri);
            }
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for downloading");
                return;
            }
            if (Targets.getActive().length === 0) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            const target = Targets.getActive()[0];
            const ignoreMode = Extension.getDownloadIgnoreMode(args, target);

            target.connect(() => {
                URIs.forEach((uri) => {
                    Extension.isLikeFile(uri).then((isFile) => {
                        if (isFile) {
                            target.download(uri, undefined, ignoreMode.forFile);
                        } else {
                            target.downloadDir(uri, ignoreMode.forDir);
                        }
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-filtered", (...args) => {
            return vscode.commands.executeCommand("pro-deployer.download", ...args, Extension.filterIgnoredArg);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-from", (...args) => {
            const URIs = [] as vscode.Uri[];
            args.forEach((arg) => {
                if (arg instanceof vscode.Uri) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg);
                    }
                }
                if ("resourceUri" in arg) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.resourceUri.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg.resourceUri);
                    }
                }
                if (Array.isArray(arg)) {
                    arg.forEach((uri) => {
                        if (uri instanceof vscode.Uri) {
                            const checkExist = URIs.find((item) => {
                                return item.toString() === uri.toString();
                            });
                            if (!checkExist) {
                                URIs.push(uri);
                            }
                        }
                    });
                }
            });
            if (URIs.length === 0 && vscode.window.activeTextEditor?.document.uri) {
                URIs.push(vscode.window.activeTextEditor?.document.uri);
            }
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for downloading");
                return;
            }

            const items = Targets.getItems().map((item) => {
                return {
                    label: item.getName(),
                    description: item.getWorkspaceFolder().name,
                    target: item,
                };
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = value.target;
                const ignoreMode = Extension.getDownloadIgnoreMode(args, target);

                target.connect(() => {
                    URIs.forEach((uri) => {
                        Extension.isLikeFile(uri).then((isFile) => {
                            if (isFile) {
                                target.download(uri, undefined, ignoreMode.forFile);
                            } else {
                                target.downloadDir(uri, ignoreMode.forDir);
                            }
                        });
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-from-filtered", (...args) => {
            return vscode.commands.executeCommand("pro-deployer.download-from", ...args, Extension.filterIgnoredArg);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-all-files", (...args) => {
            const workspaceFolder = Extension.getActiveWorkspaceFolder();

            if (!workspaceFolder) {
                Extension.showErrorMessage("Can't find workspace folder");
                return;
            }

            const items = Targets.getItems().map((item) => {
                return {
                    label: item.getName(),
                    description: item.getWorkspaceFolder().name,
                    target: item,
                };
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = value.target;
                const ignoreMode = Extension.getDownloadIgnoreMode(args, target);

                target.connect(() => {
                    target.downloadDir(workspaceFolder.uri, ignoreMode.forDir);
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-all-files-filtered", () => {
            return vscode.commands.executeCommand("pro-deployer.download-all-files", Extension.filterIgnoredArg);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.delete", (...args) => {
            const URIs = [] as vscode.Uri[];
            args.forEach((arg) => {
                if (arg instanceof vscode.Uri) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg);
                    }
                }
                if ("resourceUri" in arg) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.resourceUri.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg.resourceUri);
                    }
                }
                if (Array.isArray(arg)) {
                    arg.forEach((uri) => {
                        if (uri instanceof vscode.Uri) {
                            const checkExist = URIs.find((item) => {
                                return item.toString() === uri.toString();
                            });
                            if (!checkExist) {
                                URIs.push(uri);
                            }
                        }
                    });
                }
            });
            if (URIs.length === 0 && vscode.window.activeTextEditor?.document.uri) {
                URIs.push(vscode.window.activeTextEditor?.document.uri);
            }
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for deleting");
                return;
            }
            if (Targets.getActive().length === 0) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            const target = Targets.getActive()[0];

            target.connect(() => {
                URIs.forEach((uri) => {
                    Extension.isLikeFile(uri).then((isFile) => {
                        if (isFile) {
                            target.delete(uri);
                        } else {
                            target.deleteDir(uri);
                        }
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.delete-from", (...args) => {
            const URIs = [] as vscode.Uri[];
            args.forEach((arg) => {
                if (arg instanceof vscode.Uri) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg);
                    }
                }
                if ("resourceUri" in arg) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.resourceUri.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg.resourceUri);
                    }
                }
                if (Array.isArray(arg)) {
                    arg.forEach((uri) => {
                        if (uri instanceof vscode.Uri) {
                            const checkExist = URIs.find((item) => {
                                return item.toString() === uri.toString();
                            });
                            if (!checkExist) {
                                URIs.push(uri);
                            }
                        }
                    });
                }
            });
            if (URIs.length === 0 && vscode.window.activeTextEditor?.document.uri) {
                URIs.push(vscode.window.activeTextEditor?.document.uri);
            }
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for deleting");
                return;
            }

            const items = Targets.getItems().map((item) => {
                return {
                    label: item.getName(),
                    description: item.getWorkspaceFolder().name,
                    target: item,
                };
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = value.target;

                target.connect(() => {
                    URIs.forEach((uri) => {
                        Extension.isLikeFile(uri).then((isFile) => {
                            if (isFile) {
                                target.delete(uri);
                            } else {
                                target.deleteDir(uri);
                            }
                        });
                    });
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.diff-with", (...args) => {
            const workspaceFolder = Extension.getActiveWorkspaceFolder();
            if (!workspaceFolder) {
                Extension.showErrorMessage("Can't find workspace folder");
                return;
            }

            const URIs = [] as vscode.Uri[];
            args.forEach((arg) => {
                if (arg instanceof vscode.Uri) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg);
                    }
                }
                if ("resourceUri" in arg) {
                    const checkExist = URIs.find((item) => {
                        return item.toString() === arg.resourceUri.toString();
                    });
                    if (!checkExist) {
                        URIs.push(arg.resourceUri);
                    }
                }
                if (Array.isArray(arg)) {
                    arg.forEach((uri) => {
                        if (uri instanceof vscode.Uri) {
                            const checkExist = URIs.find((item) => {
                                return item.toString() === uri.toString();
                            });
                            if (!checkExist) {
                                URIs.push(uri);
                            }
                        }
                    });
                }
            });
            if (URIs.length === 0 && vscode.window.activeTextEditor?.document.uri) {
                URIs.push(vscode.window.activeTextEditor?.document.uri);
            }
            if (URIs.length !== 1) {
                Extension.showErrorMessage("Select one file for diff");
                return;
            }
            const uri = URIs[0];

            const items = Targets.getItems().map((item) => {
                return {
                    label: item.getName(),
                    description: item.getWorkspaceFolder().name,
                    target: item,
                };
            });
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = value.target;

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
