import * as vscode from "vscode";
import { Configs } from "./configs";
import { Targets } from "./targets/Targets";
import fs = require("fs");
import micromatch = require("micromatch");

export class Extension {
    public static mode = "dev";
    public static extensionContext: vscode.ExtensionContext;
    public static outputChannel: vscode.OutputChannel | null;

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

    public static appendLineToOutputChannel(string: string) {
        if (this.mode !== "dev") {
            return;
        }
        const date = new Date();
        if (Extension.outputChannel) {
            Extension.outputChannel.appendLine("[" + date.toISOString() + "]" + string);
        }
    }

    public static showErrorMessage(string: string) {
        vscode.window.showErrorMessage("[PRO Deployer] " + string);
        Extension.appendLineToOutputChannel("[ERROR] " + string);
    }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    Extension.extensionContext = context;

    Extension.init();

    Configs.init(() => {
        Targets.destroyAllTargets();

        Configs.getConfigs().targets?.forEach((targetConfig) => {
            let target = Targets.getTargetInstance(targetConfig);
            if (target) {
                Targets.add(target);
            }
        });
    });

    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        // console.log("onDidChangeWorkspaceFolders", vscode.workspace.workspaceFolders, e);
    });
    vscode.workspace.onWillDeleteFiles((e) => {
        if (Configs.getConfigs().autoDelete === false) {
            return;
        }
        e.files.forEach((uri) => {
            if (uri.path === Configs.getConfigFile().path) {
                Extension.appendLineToOutputChannel("SKIP config file");
                return;
            }
            if (micromatch.isMatch(vscode.workspace.asRelativePath(uri.path), Configs.getConfigs().ignore)) {
                Extension.appendLineToOutputChannel("File ignored: " + vscode.workspace.asRelativePath(uri.path));
                return;
            }

            vscode.workspace.fs.stat(uri).then((fileStat) => {
                if (fileStat.type === vscode.FileType.File) {
                    Targets.delete(uri);
                } else {
                    Targets.deleteDir(uri);
                }
            });
        });
    });
    vscode.workspace.onDidSaveTextDocument((e) => {
        if (Configs.getConfigs().uploadOnSave === false) {
            return;
        }
        let uri = e.uri;
        if (uri.path === Configs.getConfigFile().path) {
            Extension.appendLineToOutputChannel("SKIP config file");
            return;
        }
        if (micromatch.isMatch(vscode.workspace.asRelativePath(uri.path), Configs.getConfigs().ignore)) {
            Extension.appendLineToOutputChannel("File ignored: " + vscode.workspace.asRelativePath(uri.path));
            return;
        }
        Targets.upload(uri);
    });

    // The commandId parameter must match the command field in package.json
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.generate-config-file", () => {
            Configs.generateConfigFile();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload-to", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            if (!thisArg) {
                if (!uri && vscode.window.activeTextEditor?.document.uri) {
                    uri = vscode.window.activeTextEditor?.document.uri;
                }
                thisArg = [uri];
            }
            if (!thisArg) {
                Extension.showErrorMessage("Can't files for uploading");
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

                thisArg.forEach((uri) => {
                    vscode.workspace.fs.stat(uri).then((fileStat) => {
                        if (fileStat.type === vscode.FileType.File) {
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
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            let file = fs.readFileSync(Extension.getActiveWorkspaceFolderPath() + "/.gitignore");

            if (!thisArg) {
                if (!uri && vscode.window.activeTextEditor?.document.uri) {
                    uri = vscode.window.activeTextEditor?.document.uri;
                }
                thisArg = [uri];
            }
            if (!thisArg) {
                Extension.showErrorMessage("Can't files for uploading");
                return;
            }

            thisArg.forEach((uri) => {
                vscode.workspace.fs.stat(uri).then((fileStat) => {
                    if (fileStat.type === vscode.FileType.File) {
                        Targets.upload(uri);
                    } else {
                        vscode.workspace.findFiles(vscode.workspace.asRelativePath(uri) + "/**/*").then((files) => {
                            files.forEach((uri) => {
                                Targets.upload(uri);
                            });
                        });
                    }
                });
            });
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("pro-deployer.upload-all-open", (uri: vscode.Uri, thisArg: vscode.Uri[]) => {
            console.log("vscode.workspace.textDocuments", vscode.workspace.textDocuments);
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
                files.forEach((textDocument) => {
                    target.upload(textDocument.uri);
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
}
