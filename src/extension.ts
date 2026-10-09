import * as vscode from "vscode";
import { Configs } from "./configs";
import { Targets } from "./targets/Targets";
import { SecretManager } from "./SecretManager";
import fs = require("fs");
import micromatch = require("micromatch");
import parser = require("gitignore-parser");
import { QueueTask, TargetInterface } from "./targets/Interfaces";
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

    public static async getKind(uri: vscode.Uri): Promise<"file" | "dir" | "unknown"> {
        try {
            const fileStat = await vscode.workspace.fs.stat(uri);
            // Bit test, because a symlink reports e.g. File | SymbolicLink
            return fileStat.type & vscode.FileType.Directory ? "dir" : "file";
        } catch {
            return "unknown";
        }
    }

    public static async isLikeFile(uri: vscode.Uri): Promise<boolean> {
        const kind = await Extension.getKind(uri);
        if (kind !== "unknown") {
            return kind === "file";
        }
        // The path doesn't exist locally (e.g. already deleted), so guess from the name
        const name = uri.toString().split("/").pop();
        if (!name) {
            throw new Error("Can't get file or folder name");
        }
        return name.split(".").length > 1;
    }

    private static gitignoreCache = new Map<string, { mtimeMs: number; parsed: ReturnType<typeof parser.compile> }>();

    // Compiled once per .gitignore version; this runs for every file event
    private static getGitignore(uri: vscode.Uri): ReturnType<typeof parser.compile> | undefined {
        const file = Configs.getGitignoreFile(uri).fsPath;
        try {
            const mtimeMs = fs.statSync(file).mtimeMs;
            const cached = Extension.gitignoreCache.get(file);
            if (cached && cached.mtimeMs === mtimeMs) {
                return cached.parsed;
            }
            const parsed = parser.compile(fs.readFileSync(file).toString());
            Extension.gitignoreCache.set(file, { mtimeMs, parsed });
            return parsed;
        } catch {
            return undefined;
        }
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
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        const log = (message: string) => {
            if (!quiet) {
                Extension.appendLineToOutputChannel(message);
            }
        };

        if (uri.scheme === "git") {
            log("File ignored (git): " + relativePath);
            return true;
        }
        if (uri.path === Configs.getConfigFile(uri).path) {
            log("File ignored (config file)");
            return true;
        }
        const configs = Configs.getWorkspaceConfigs(uri);
        const ignorePatterns = configs.ignore;
        // Patterns like "logs/**/*" only match children, so probe the directory with a fake child.
        if (
            micromatch.isMatch(relativePath, ignorePatterns, { dot: true }) ||
            (isDirectory && micromatch.isMatch(relativePath + "/__dir__", ignorePatterns, { dot: true }))
        ) {
            log("File/folder ignored (ignore option): " + relativePath);
            return true;
        }
        // A directory can't be tested against include patterns (e.g. "src/**/*.ts"), its files are tested instead.
        if (!isDirectory && configs.include.length > 0) {
            if (micromatch.isMatch(relativePath, configs.include, { dot: true }) === false) {
                log("File/folder not included (include option): " + relativePath);
                return true;
            }
        }
        if (configs.checkGitignore) {
            if (Extension.getGitignore(uri)?.denies(relativePath)) {
                log("File ignored (.gitignore): " + relativePath);
                return true;
            }
        }
        return false;
    }
}

function collectUris(args: any[]): vscode.Uri[] {
    const uris = new Map<string, vscode.Uri>();
    const add = (value: unknown) => {
        if (value instanceof vscode.Uri) {
            uris.set(value.toString(), value);
        }
    };
    args.forEach((arg) => {
        if (Array.isArray(arg)) {
            arg.forEach(add);
        } else if (arg instanceof vscode.Uri) {
            add(arg);
        } else if (typeof arg === "object" && arg !== null && "resourceUri" in arg) {
            add(arg.resourceUri);
        }
    });
    if (uris.size === 0) {
        add(vscode.window.activeTextEditor?.document.uri);
    }
    return [...uris.values()];
}

function targetQuickPickItems(targets: TargetInterface[]) {
    return targets.map((item) => ({
        label: item.getName(),
        description: item.getWorkspaceFolder().name,
        target: item,
    }));
}

// Task failures are reported through the queue; this only keeps rejected promises from going unhandled
function logFailure(what: string) {
    return (reason: unknown) => {
        Extension.appendLineToOutputChannel("[ERROR] " + what + ": " + reason);
    };
}

function queueUpload(target: TargetInterface, uri: vscode.Uri) {
    const key = uri.toString();
    // One save can fire several watcher events; one pending upload is enough
    const alreadyQueued = target
        .getQueue()
        .getPendingTasks()
        .some((task) => task.action === "upload" && task.uri.toString() === key);
    if (alreadyQueued) {
        return;
    }
    target.upload(uri).catch(logFailure("Can't upload " + uri.path));
}

function uploadUris(target: TargetInterface, uris: vscode.Uri[]) {
    target.connect(() => {
        uris.forEach(async (uri) => {
            try {
                if (await Extension.isLikeFile(uri)) {
                    queueUpload(target, uri);
                    return;
                }
                const folder = target.getWorkspaceFolder();
                const relative = vscode.workspace.asRelativePath(uri, false);
                const prefix = uri.path === folder.uri.path ? "" : relative + "/";
                const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, prefix + "**/*"));
                files.forEach((file) => {
                    // findFiles only knows files.exclude, so the extension's own ignore rules are applied here
                    if (!Extension.isUriIgnored(file, false, true)) {
                        queueUpload(target, file);
                    }
                });
            } catch (error) {
                logFailure("Can't upload " + uri.path)(error);
            }
        });
    }, logFailure("Can't connect to " + target.getName()));
}

async function deleteUri(target: TargetInterface, uri: vscode.Uri) {
    const kind = await Extension.getKind(uri);
    if (kind === "dir") {
        await target.deleteDir(uri);
    } else if (kind === "file") {
        await target.delete(uri);
    } else {
        // Already gone locally, so file vs. directory is unknown; unlink fails harmlessly on a directory
        try {
            await target.delete(uri, { quiet: true });
        } catch {
            await target.deleteDir(uri);
        }
    }
}

async function confirmDelete(uris: vscode.Uri[], targetName: string): Promise<boolean> {
    const kinds = await Promise.all(uris.map((uri) => Extension.getKind(uri)));
    if (!kinds.includes("dir")) {
        return true;
    }
    const answer = await vscode.window.showWarningMessage(
        "Delete " + uris.length + " item(s), including directories, from '" + targetName + "'? This can't be undone.",
        { modal: true },
        "Delete"
    );
    return answer === "Delete";
}

function deleteUris(target: TargetInterface, uris: vscode.Uri[]) {
    confirmDelete(uris, target.getName()).then((confirmed) => {
        if (!confirmed) {
            return;
        }
        target.connect(() => {
            uris.forEach((uri) => {
                deleteUri(target, uri).catch(logFailure("Can't delete " + uri.path));
            });
        }, logFailure("Can't connect to " + target.getName()));
    });
}

function downloadUris(target: TargetInterface, uris: vscode.Uri[], ignoreMode: { forFile: boolean; forDir: boolean }) {
    target.connect(() => {
        uris.forEach((uri) => {
            Extension.isLikeFile(uri).then((isFile) => {
                const download = isFile
                    ? target.download(uri, undefined, ignoreMode.forFile)
                    : target.downloadDir(uri, ignoreMode.forDir);
                download.catch(logFailure("Can't download " + uri.path));
            }, logFailure("Can't download " + uri.path));
        });
    }, logFailure("Can't connect to " + target.getName()));
}

function describeJob(job: QueueTask, target: TargetInterface, prefix = "") {
    return (
        job.action[0].toUpperCase() +
        job.action.slice(1) +
        " (" +
        (target.getQueue().getPendingTasks().length + 1) +
        " pending) => " +
        prefix +
        vscode.workspace.asRelativePath(job.uri)
    );
}

let statusBarCheckTimer: NodeJS.Timeout | undefined;
let tooltipText = "";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    Extension.extensionContext = context;

    Extension.init();

    Configs.init(() => {
        Targets.destroyAllTargets();
        // A timer from the previous config load would otherwise keep running
        clearInterval(statusBarCheckTimer);
        statusBarCheckTimer = undefined;
        Extension.statusBarItem?.dispose();
        Extension.statusBarItem = null;

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

        Targets.getItems().forEach((target) => {
            target.getQueue().on("start", () => {
                if (Extension.statusBarItem) {
                    Extension.statusBarItem!.text = "$(sync~spin) PRO Deployer";

                    if (!statusBarCheckTimer) {
                        statusBarCheckTimer = setInterval(() => {
                            let allPendingTasks = 0;
                            Targets.getItems().forEach((target) => {
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
                                const onJobDone = (job: QueueTask) => {
                                    progress.report({ message: describeJob(job, target) });
                                };
                                target.getQueue().on("task.success", onJobDone);
                                target.getQueue().on("task.error", onJobDone);
                                target.getQueue().once("end", () => {
                                    target.getQueue().off("task.success", onJobDone);
                                    target.getQueue().off("task.error", onJobDone);
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
                if (Extension.statusBarItem) {
                    let allPendingTasks = 0;
                    Targets.getItems().forEach((target) => {
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
                if (Extension.statusBarItem) {
                    Extension.statusBarItem.backgroundColor = undefined;
                    tooltipText = describeJob(job, target);
                }
            });
            target.getQueue().on("task.error", (job: QueueTask, error: string) => {
                if (job.quiet) {
                    return;
                }
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
                if (Extension.statusBarItem) {
                    Extension.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
                    tooltipText = describeJob(job, target, "ERROR: ");
                }
            });
        });
    });

    const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");

    // Targets come from the folder that owns the file, not from the active editor
    const uploadOnEvent = async (uri: vscode.Uri, includeDirectories: boolean) => {
        if (Configs.getWorkspaceConfigs(uri).uploadOnSave === false) {
            return;
        }
        if (Extension.isUriIgnored(uri)) {
            return;
        }
        const targets = Targets.getActiveForUri(uri);
        // A change event on a directory would re-upload everything inside it
        if (targets.length === 0 || (!includeDirectories && (await Extension.getKind(uri)) === "dir")) {
            return;
        }
        targets.forEach((target) => uploadUris(target, [uri]));
    };
    fileWatcher.onDidCreate((uri) => uploadOnEvent(uri, true).catch(logFailure("Can't handle " + uri.path)));
    fileWatcher.onDidChange((uri) => uploadOnEvent(uri, false).catch(logFailure("Can't handle " + uri.path)));
    fileWatcher.onDidDelete((uri) => {
        if (Configs.getWorkspaceConfigs(uri).autoDelete === false) {
            return;
        }
        if (Extension.isUriIgnored(uri)) {
            return;
        }

        Targets.getActiveForUri(uri).forEach((target) => {
            target.connect(() => {
                deleteUri(target, uri).catch(logFailure("Can't delete " + uri.path));
            }, logFailure("Can't connect to " + target.getName()));
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
            const URIs = collectUris(args);
            const targetArg = args.find(
                (arg) => typeof arg === "object" && arg !== null && typeof arg.target === "string"
            );
            const targetName: string | undefined = targetArg?.target;
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for uploading");
                return;
            }

            const folder = vscode.workspace.getWorkspaceFolder(URIs[0]) ?? Extension.getActiveWorkspaceFolder();
            const availableTargets = Targets.getItems().filter(
                (item) => item.getWorkspaceFolder().uri.path === folder?.uri.path
            );

            if (targetName) {
                const target = availableTargets.find((t) => t.getName() === targetName);
                if (target) {
                    uploadUris(target, URIs);
                } else {
                    Extension.showErrorMessage(`Target '${targetName}' not found in active workspace.`);
                }
                return;
            }

            vscode.window.showQuickPick(targetQuickPickItems(availableTargets)).then((value) => {
                if (value) {
                    uploadUris(value.target, URIs);
                }
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload", (...args) => {
            const URIs = collectUris(args);
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for uploading");
                return;
            }

            const targets = Targets.getActiveForUri(URIs[0]);
            if (targets.length === 0) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            targets.forEach((target) => uploadUris(target, URIs));
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

            vscode.window.showQuickPick(targetQuickPickItems(Targets.getItems())).then((value) => {
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
                        queueUpload(target, uri);
                    });
                }, logFailure("Can't connect to " + target.getName()));
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
            // Prefer the repository of the active workspace folder
            const activeFolderPath = Extension.getActiveWorkspaceFolder()?.uri.path;
            const repo = git.repositories.find((item) => item.rootUri.path === activeFolderPath) ?? git.repositories[0];
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

            vscode.window.showQuickPick(targetQuickPickItems(Targets.getItems())).then((value) => {
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
                        queueUpload(target, uri);
                    });
                }, logFailure("Can't connect to " + target.getName()));
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download", (...args) => {
            const URIs = collectUris(args);
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for downloading");
                return;
            }
            const target = Targets.getActiveForUri(URIs[0])[0];
            if (!target) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            downloadUris(target, URIs, Extension.getDownloadIgnoreMode(args, target));
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-filtered", (...args) => {
            return vscode.commands.executeCommand("pro-deployer.download", ...args, Extension.filterIgnoredArg);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.download-from", (...args) => {
            const URIs = collectUris(args);
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for downloading");
                return;
            }

            vscode.window.showQuickPick(targetQuickPickItems(Targets.getItems())).then((value) => {
                if (!value) {
                    return;
                }

                const target = value.target;
                downloadUris(target, URIs, Extension.getDownloadIgnoreMode(args, target));
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

            // Only targets of this workspace folder, or the remote would be downloaded into the wrong folder
            const items = targetQuickPickItems(
                Targets.getItems().filter((item) => item.getWorkspaceFolder().uri.path === workspaceFolder.uri.path)
            );
            vscode.window.showQuickPick(items).then((value) => {
                if (!value) {
                    return;
                }

                const target = value.target;
                const ignoreMode = Extension.getDownloadIgnoreMode(args, target);

                target.connect(() => {
                    target
                        .downloadDir(workspaceFolder.uri, ignoreMode.forDir)
                        .catch(logFailure("Can't download " + workspaceFolder.uri.path));
                }, logFailure("Can't connect to " + target.getName()));
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
            const URIs = collectUris(args);
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for deleting");
                return;
            }
            const target = Targets.getActiveForUri(URIs[0])[0];
            if (!target) {
                Extension.showErrorMessage("No active targets");
                return;
            }

            deleteUris(target, URIs);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.delete-from", (...args) => {
            const URIs = collectUris(args);
            if (URIs.length === 0) {
                Extension.showErrorMessage("Can't find files for deleting");
                return;
            }

            vscode.window.showQuickPick(targetQuickPickItems(Targets.getItems())).then((value) => {
                if (value) {
                    deleteUris(value.target, URIs);
                }
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

            const URIs = collectUris(args);
            if (URIs.length !== 1) {
                Extension.showErrorMessage("Select one file for diff");
                return;
            }
            const uri = URIs[0];

            vscode.window.showQuickPick(targetQuickPickItems(Targets.getItems())).then((value) => {
                if (!value) {
                    return;
                }

                const target = value.target;

                target.connect(() => {
                    Extension.isLikeFile(uri).then((isFile) => {
                        if (!isFile) {
                            Extension.showErrorMessage("Can't diff directory");
                            return;
                        }
                        const destination = vscode.Uri.parse("pro-deployer-fs:/" + vscode.workspace.asRelativePath(uri));
                        target.download(uri, destination).then(() => {
                            vscode.commands.executeCommand("vscode.diff", destination, uri);
                        }, logFailure("Can't diff " + uri.path));
                    }, logFailure("Can't diff " + uri.path));
                }, logFailure("Can't connect to " + target.getName()));
            });
        })
    );
}

// this method is called when your extension is deactivated
export function deactivate() {
    clearInterval(statusBarCheckTimer);
    Targets.destroyAllTargets();
    if (Extension.outputChannel) {
        Extension.outputChannel.dispose();
    }
    if (Extension.statusBarItem) {
        Extension.statusBarItem.dispose();
    }
}
