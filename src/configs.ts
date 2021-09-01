import { TextEncoder } from "util";
import * as vscode from "vscode";
import * as fs from "fs";
import { Extension } from "./extension";
import { ConfigsInterface, TargetOptionsInterface } from "./targets/Interfaces";

export class Configs {
    public static readonly sampleConfig = {
        uploadOnSave: true,
        autoDelete: true,
        activeTargets: ["My FTP"],
        concurrency: 5,
        ignore: [".git/**/*", ".vscode/**/*"],
        targets: [
            {
                name: "My FTP",
                type: "ftp",
                host: "localhost",
                port: 21,
                user: "admin",
                password: "123456",
                dir: "/",
            },
            {
                name: "My SFTP",
                type: "sftp",
                host: "localhost",
                port: 22,
                user: "admin",
                password: "123456",
                dir: "/",
            },
        ],
    };

    public static readonly defaultConfigs: ConfigsInterface = {
        autoDelete: true,
        uploadOnSave: true,
        checkGitignore: true,
        concurrency: 5,
        ignore: [".git/**/*", ".vscode/**/*"],
        activeTargets: [],
        targets: [],
    };
    private static configs: ConfigsInterface = Configs.defaultConfigs;
    public static getConfigs() {
        return this.configs;
    }
    public static getConfigFile(): vscode.Uri {
        return vscode.Uri.file(Extension.getActiveWorkspaceFolderPath() + "/.vscode/pro-deployer.json");
    }
    public static getGitignoreFile(): vscode.Uri {
        return vscode.Uri.file(Extension.getActiveWorkspaceFolderPath() + "/.gitignore");
    }
    public static generateConfigFile() {
        if (!Extension.getActiveWorkspaceFolderPath()) {
            Extension.showErrorMessage("Can't get active workspace folder.");
            return;
        }

        const configFile = vscode.Uri.file(Extension.getActiveWorkspaceFolderPath() + "/.vscode/pro-deployer.json");

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
    public static init(cb: Function) {
        vscode.workspace.fs.readFile(this.getConfigFile()).then((value) => {
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

            this.configs = Object.assign({}, this.defaultConfigs, fileConfigs, workspaceConfigs);
            if (fileConfigs.ignore) {
                this.configs.ignore = fileConfigs.ignore;
            }
            Extension.appendLineToOutputChannel("[INFO] The config file is loaded: " + JSON.stringify(this.configs));
            cb();
        });

        const disposables = vscode.workspace.onDidSaveTextDocument((e) => {
            if (e.uri.path === Configs.getConfigFile().path) {
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
        });
        Extension.extensionContext.subscriptions.push(disposables);
    }
}
