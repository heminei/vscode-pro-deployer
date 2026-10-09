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
    public static getConfigFile(): vscode.Uri {
        return vscode.Uri.file(Extension.getActiveWorkspaceFolder()?.uri.path + "/.vscode/pro-deployer.json");
    }
    public static getWorkspaceConfigs(uri?: vscode.Uri): ConfigsInterface {
        if (uri) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (workspaceFolder) {
                return this.workspaceConfigs[workspaceFolder.uri.path + "/.vscode/pro-deployer.json"];
            }
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const activeDocumentUri = activeEditor.document.uri;
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
            if (workspaceFolder) {
                return this.workspaceConfigs[workspaceFolder.uri.path + "/.vscode/pro-deployer.json"];
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
                    targets.push({
                        options: target,
                        workspaceFolder: vscode.workspace.getWorkspaceFolder(vscode.Uri.file(key))!,
                    });
                });
            }
        });
        return targets;
    }
    public static getGitignoreFile(): vscode.Uri {
        return vscode.Uri.file(Extension.getActiveWorkspaceFolder()?.uri.path + "/.gitignore");
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
                try {
                    fileConfigs = JSON.parse(value.toString());
                } catch (error) {
                    Extension.showErrorMessage("Can't parse config file. Check config syntax.");
                    return;
                }

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

        const disposables = vscode.workspace.onDidSaveTextDocument((e) => {
            const isConfigFile =
                this.getWorkspaceConfigFiles().findIndex(
                    (file) =>
                        vscode.workspace.asRelativePath(e.uri.path) === vscode.workspace.asRelativePath(file.path),
                ) > -1;
            if (isConfigFile) {
                this.loadAll().finally(() => {
                    cb();
                });
            }
        });
        Extension.extensionContext.subscriptions.push(disposables);
    }
}
