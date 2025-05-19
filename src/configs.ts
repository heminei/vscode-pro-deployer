import { TextEncoder } from "util";
import * as vscode from "vscode";
import { Extension } from "./extension";
import { ConfigsInterface, TargetOptionsInterface } from "./targets/Interfaces";

export class Configs {
    public static readonly sampleConfig: ConfigsInterface = {
        enableStatusBarItem: true,
        enableQuickPick: true,
        uploadOnSave: true,
        autoDelete: true,
        checkGitignore: false,
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
            },
        ] as TargetOptionsInterface[],
    };

    public static readonly defaultConfigs: ConfigsInterface = {
        enableStatusBarItem: true,
        enableQuickPick: true,
        autoDelete: true,
        uploadOnSave: true,
        checkGitignore: false,
        concurrency: 5,
        ignore: [".git/**/*", ".vscode/**/*"],
        include: [],
        activeTargets: [],
        targets: [],
    };
    private static configs: ConfigsInterface = Configs.defaultConfigs;
    private static workspaceConfigs: { [index: string]: ConfigsInterface } = {};

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
            Extension.getActiveWorkspaceFolder()?.uri.path + "/.vscode/pro-deployer.json"
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
                        }
                    );
            }
        );
    }
    public static init(cb: Function) {
        const promises = [] as Thenable<Uint8Array<ArrayBufferLike>>[];
        this.getWorkspaceConfigFiles().forEach((file, index) => {
            const promise = vscode.workspace.fs.readFile(file);
            promises.push(promise);
            promise.then((value) => {
                let workspaceConfigs = Extension.extensionContext.workspaceState.get("configs");
                if (!workspaceConfigs) {
                    workspaceConfigs = {};
                }

                let fileConfigs = {} as ConfigsInterface;
                try {
                    fileConfigs = JSON.parse(value.toString());
                } catch (error) {
                    Extension.showErrorMessage("Can't parse config file. Check config syntax.");
                    return;
                }

                const configs = Object.assign({}, this.defaultConfigs, fileConfigs, workspaceConfigs);
                if (fileConfigs.ignore) {
                    configs.ignore = fileConfigs.ignore;
                }
                if (index === 0) {
                    this.configs = configs;
                }
                this.workspaceConfigs[file.path] = configs;
                Extension.appendLineToOutputChannel("[INFO] The config file is loaded: " + JSON.stringify(configs));
            });
        });

        Promise.allSettled(promises).finally(() => {
            cb();
        });

        const disposables = vscode.workspace.onDidSaveTextDocument((e) => {
            if (
                vscode.workspace.asRelativePath(e.uri.path) ===
                vscode.workspace.asRelativePath(Configs.getConfigFile().path)
            ) {
                let workspaceConfigs = Extension.extensionContext.workspaceState.get("configs");
                if (!workspaceConfigs) {
                    workspaceConfigs = {};
                }

                let fileConfigs = {} as ConfigsInterface;
                try {
                    fileConfigs = JSON.parse(e.getText());
                } catch (error) {
                    Extension.showErrorMessage("Can't parse config file. Check config syntax.");
                    return;
                }
                this.configs = Object.assign({}, this.defaultConfigs, fileConfigs, workspaceConfigs);
                if (fileConfigs.ignore) {
                    this.configs.ignore = fileConfigs.ignore;
                }
                Extension.appendLineToOutputChannel(
                    "[INFO] The config file is updated: " + JSON.stringify(this.configs)
                );
                cb();
            }

            if (
                this.getWorkspaceConfigFiles().findIndex(
                    (file) => vscode.workspace.asRelativePath(e.uri.path) === vscode.workspace.asRelativePath(file.path)
                ) > -1
            ) {
                this.workspaceConfigs = {};
                this.getWorkspaceConfigFiles().forEach((file, index) => {
                    const promise = vscode.workspace.fs.readFile(file);
                    promises.push(promise);
                    promise.then((value) => {
                        let workspaceConfigs = Extension.extensionContext.workspaceState.get("configs");
                        if (!workspaceConfigs) {
                            workspaceConfigs = {};
                        }

                        let fileConfigs = {} as ConfigsInterface;
                        try {
                            fileConfigs = JSON.parse(value.toString());
                        } catch (error) {
                            Extension.showErrorMessage("Can't parse config file. Check config syntax.");
                            return;
                        }

                        const configs = Object.assign({}, this.defaultConfigs, fileConfigs, workspaceConfigs);
                        if (fileConfigs.ignore) {
                            configs.ignore = fileConfigs.ignore;
                        }
                        if (index === 0) {
                            this.configs = configs;
                        }
                        this.workspaceConfigs[file.path] = configs;

                        Extension.appendLineToOutputChannel(
                            "[INFO] The config file is loaded: " + JSON.stringify(this.configs)
                        );
                    });
                });

                Promise.all(promises).then(() => {
                    cb();
                });
            }
        });
        Extension.extensionContext.subscriptions.push(disposables);
    }
}
