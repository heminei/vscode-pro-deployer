import { TextEncoder } from "util";
import * as vscode from "vscode";
import * as jsonc from "jsonc-parser";
import { Extension } from "./extension";
import { ConfigsInterface, TargetOptionsInterface } from "./targets/Interfaces";
import { VariableResolver } from "./VariableResolver";
import { SecretManager } from "./SecretManager";

export class Configs {
    public static readonly sampleConfig: ConfigsInterface = {
        enableStatusBarItem: true,
        enableQuickPick: true,
        uploadOnSave: true,
        autoDelete: true,
        checkGitignore: false,
        respectIgnoreOnDownload: false,
        activeTargets: ["My SFTP"],
        concurrency: 5,
        ignore: [".git/**/*", ".vscode/**/*"],
        include: [],
        targets: [
            {
                name: "My SFTP",
                type: "sftp",
                host: "localhost",
                port: 22,
                user: "admin",
                password: "123456",
                dir: "/",
                baseDir: "/",
                privateKey: null,
                passphrase: null,
                useAuthAgent: false,
                authAgentPath: null,
                keepaliveIntervalMs: 10000,
                preserveMtime: false,
            },
            {
                name: "My FTP",
                type: "ftp",
                host: "localhost",
                port: 21,
                user: "admin",
                password: "123456",
                dir: "/",
                baseDir: "/",
                transferDataType: "binary",
                secure: false,
                keepaliveIntervalMs: 10000,
                preserveMtime: false,
            },
        ] as TargetOptionsInterface[],
    };

    public static readonly defaultConfigs: ConfigsInterface = {
        enableStatusBarItem: true,
        enableQuickPick: true,
        autoDelete: true,
        uploadOnSave: true,
        checkGitignore: false,
        respectIgnoreOnDownload: false,
        concurrency: 5,
        ignore: [".git/**/*", ".vscode/**/*"],
        include: [],
        activeTargets: [],
        targets: [],
    };
    private static configs: ConfigsInterface = Configs.defaultConfigs;
    private static workspaceConfigs: { [index: string]: ConfigsInterface } = {};
    private static onLoaded: Function | undefined;

    public static getConfigs() {
        return this.configs;
    }
    private static getFolderFor(uri?: vscode.Uri): vscode.WorkspaceFolder | null {
        return (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined) ?? Extension.getActiveWorkspaceFolder();
    }
    public static getConfigFile(uri?: vscode.Uri): vscode.Uri {
        return vscode.Uri.file(this.getFolderFor(uri)?.uri.path + "/.vscode/pro-deployer.json");
    }
    public static getWorkspaceConfigs(uri?: vscode.Uri): ConfigsInterface {
        // A folder without a (valid) config file falls back to the defaults instead of undefined
        if (uri) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (workspaceFolder) {
                return (
                    this.workspaceConfigs[workspaceFolder.uri.path + "/.vscode/pro-deployer.json"] ?? this.defaultConfigs
                );
            }
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const activeDocumentUri = activeEditor.document.uri;
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
            if (workspaceFolder) {
                return (
                    this.workspaceConfigs[workspaceFolder.uri.path + "/.vscode/pro-deployer.json"] ?? this.defaultConfigs
                );
            }
        }
        return this.configs;
    }
    public static getWorkspaceConfigFiles(): vscode.Uri[] {
        const files = [] as vscode.Uri[];
        if (vscode.workspace.workspaceFolders) {
            vscode.workspace.workspaceFolders.forEach((folder) => {
                files.push(vscode.Uri.file(folder.uri.path + "/.vscode/pro-deployer.json"));
            });
        }
        return files;
    }
    public static getAllTargetOptions(): {
        options: TargetOptionsInterface;
        workspaceFolder: vscode.WorkspaceFolder;
    }[] {
        const targets = [] as { options: TargetOptionsInterface; workspaceFolder: vscode.WorkspaceFolder }[];
        Object.keys(this.workspaceConfigs).forEach((key) => {
            if (this.workspaceConfigs[key].targets) {
                this.workspaceConfigs[key].targets.forEach((target) => {
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(key));
                    if (!workspaceFolder) {
                        return;
                    }
                    targets.push({
                        options: target,
                        workspaceFolder,
                    });
                });
            }
        });
        return targets;
    }
    public static getGitignoreFile(uri?: vscode.Uri): vscode.Uri {
        return vscode.Uri.file(this.getFolderFor(uri)?.uri.path + "/.gitignore");
    }
    public static generateConfigFile() {
        if (!Extension.getActiveWorkspaceFolder()) {
            Extension.showErrorMessage("Can't get active workspace folder.");
            return;
        }

        const configFile = vscode.Uri.file(
            Extension.getActiveWorkspaceFolder()?.uri.path + "/.vscode/pro-deployer.json",
        );

        vscode.workspace.fs.stat(configFile).then(
            (fileStat) => {
                Extension.showErrorMessage("The config file is already exists! Path: " + configFile.fsPath);
            },
            (reason) => {
                vscode.workspace.fs
                    .writeFile(configFile, new TextEncoder().encode(JSON.stringify(this.sampleConfig, null, "\t")))
                    .then(
                        () => {
                            vscode.window.showTextDocument(configFile, {
                                preview: true,
                            });
                            vscode.window.showInformationMessage("The file has been generated successfully!");
                        },
                        (reason) => {
                            Extension.showErrorMessage("Can't generate config file. The file can't be written!");
                        },
                    );
            },
        );
    }
    public static async setTargetDir(configFile: vscode.Uri, targetIndex: number, dir: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(configFile);
        const wasDirty = document.isDirty;

        const edits = jsonc.modify(document.getText(), ["targets", targetIndex, "dir"], dir, {
            formattingOptions: { insertSpaces: false },
        });
        const workspaceEdit = new vscode.WorkspaceEdit();
        edits.forEach((edit) => {
            workspaceEdit.replace(
                configFile,
                new vscode.Range(document.positionAt(edit.offset), document.positionAt(edit.offset + edit.length)),
                edit.content,
            );
        });
        if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
            throw new Error("Can't update the config file");
        }
        // Saving triggers the config reload; unsaved user changes are left untouched.
        if (!wasDirty) {
            await document.save();
        }
    }

    // Never log secrets, whether typed in clear text or resolved from the keychain.
    public static stringifyRedacted(configs: unknown): string {
        return JSON.stringify(configs, (key, value) =>
            (key === "password" || key === "passphrase") && value ? "***" : value,
        );
    }

    public static async resolveSecrets(configs: ConfigsInterface): Promise<ConfigsInterface> {
        if (!Array.isArray(configs.targets)) {
            return configs;
        }
        const targets = await Promise.all(
            configs.targets.map(async (target) => {
                const resolved = { ...target };
                for (const field of ["password", "passphrase"] as const) {
                    const value = resolved[field];
                    if (typeof value === "string") {
                        resolved[field] = await SecretManager.resolveString(value);
                    }
                }
                return resolved;
            }),
        );
        return { ...configs, targets };
    }

    private static async buildConfigs(fileConfigs: ConfigsInterface, file: vscode.Uri): Promise<ConfigsInterface> {
        const workspaceConfigs = Extension.extensionContext.workspaceState.get("configs") ?? {};

        let configs = Object.assign({}, this.defaultConfigs, fileConfigs, workspaceConfigs);
        if (fileConfigs.ignore) {
            configs.ignore = fileConfigs.ignore;
        }
        // Guard against null/invalid values from the file, readers expect arrays
        for (const key of ["ignore", "include", "activeTargets", "targets"] as const) {
            if (!Array.isArray(configs[key])) {
                (configs as any)[key] = [];
            }
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
        if (workspaceFolder) {
            configs = VariableResolver.resolveObject(configs, workspaceFolder);
        }
        return this.resolveSecrets(configs);
    }

    private static async loadAll(): Promise<void> {
        const loaded: { [index: string]: ConfigsInterface } = {};

        await Promise.allSettled(
            this.getWorkspaceConfigFiles().map(async (file, index) => {
                const value = await vscode.workspace.fs.readFile(file);

                let fileConfigs = {} as ConfigsInterface;
                const parseErrors: jsonc.ParseError[] = [];
                const parsed = jsonc.parse(Buffer.from(value).toString("utf8"), parseErrors, { allowTrailingComma: true });
                if (parseErrors.length > 0 || typeof parsed !== "object" || parsed === null) {
                    Extension.showErrorMessage("Can't parse config file. Check config syntax.");
                    return;
                }
                fileConfigs = parsed;

                const configs = await this.buildConfigs(fileConfigs, file);
                if (index === 0) {
                    this.configs = configs;
                }
                loaded[file.path] = configs;
                Extension.appendLineToOutputChannel(
                    "[INFO] The config file is loaded: " + this.stringifyRedacted(configs),
                );
            }),
        );

        // Swap only when done so readers never see a half-loaded map.
        this.workspaceConfigs = loaded;
    }

    public static async reload() {
        await this.loadAll();
        this.onLoaded?.();
    }

    public static init(cb: Function) {
        this.onLoaded = cb;

        this.loadAll().finally(() => {
            cb();
        });

        // Covers saves, external edits (git checkout) and a deleted file; debounced because writes fire several events
        let reloadTimer: NodeJS.Timeout | undefined;
        const scheduleReload = () => {
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                this.loadAll().finally(() => {
                    cb();
                });
            }, 300);
        };
        const watcher = vscode.workspace.createFileSystemWatcher("**/.vscode/pro-deployer.json");
        watcher.onDidChange(scheduleReload);
        watcher.onDidCreate(scheduleReload);
        watcher.onDidDelete(scheduleReload);
        Extension.extensionContext.subscriptions.push(
            watcher,
            vscode.workspace.onDidChangeWorkspaceFolders(scheduleReload),
            { dispose: () => clearTimeout(reloadTimer) }
        );
    }
}
