import * as path from "path";
import * as vscode from "vscode";
import * as jsonc from "jsonc-parser";
import { Configs } from "./configs";
import { Extension } from "./extension";
import { TargetInterface } from "./targets/Interfaces";
import { Targets } from "./targets/Targets";

interface BrowserItem extends vscode.QuickPickItem {
    action: "select" | "open";
    path: string;
}

const CONFIG_FILE_SUFFIX = "/.vscode/pro-deployer.json";

export class RemoteBrowser {
    public static async run(configFile?: vscode.Uri, targetIndex?: number): Promise<void> {
        const file = configFile ?? (await this.pickConfigFile());
        if (!file) {
            return;
        }
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
        if (!workspaceFolder) {
            Extension.showErrorMessage("The config file is not inside a workspace folder.");
            return;
        }

        const document = await vscode.workspace.openTextDocument(file);
        const rawTargets: { name?: string; dir?: string }[] = jsonc.parse(document.getText())?.targets ?? [];
        if (rawTargets.length === 0) {
            Extension.showErrorMessage("No targets are defined in the config file.");
            return;
        }

        const index = targetIndex ?? (await this.pickTargetIndex(rawTargets));
        if (index === undefined || !rawTargets[index]) {
            return;
        }
        const rawTarget = rawTargets[index];

        const target = Targets.getItems().find(
            (item) => item.getName() === rawTarget.name && item.getWorkspaceFolder().uri.path === workspaceFolder.uri.path,
        );
        if (!target) {
            Extension.showErrorMessage(
                "Target '" + rawTarget.name + "' is not loaded. Save the config file and check its syntax.",
            );
            return;
        }

        const resolvedDir = Configs.getAllTargetOptions().find(
            (item) =>
                item.options.name === rawTarget.name && item.workspaceFolder.uri.path === workspaceFolder.uri.path,
        )?.options.dir;

        try {
            await new Promise<void>((resolve, reject) => target.connect(resolve, reject));
        } catch (error) {
            Extension.appendLineToOutputChannel("[ERROR] Can't connect to browse remote dir: " + error);
            return;
        }

        const selected = await this.browse(target, resolvedDir || "/");
        if (selected === undefined) {
            return;
        }

        if (rawTarget.dir?.includes("${")) {
            const answer = await vscode.window.showWarningMessage(
                "The current 'dir' uses a variable (" + rawTarget.dir + "). Replace it with '" + selected + "'?",
                { modal: true },
                "Replace",
            );
            if (answer !== "Replace") {
                return;
            }
        }

        try {
            await Configs.setTargetDir(file, index, selected);
        } catch (error) {
            Extension.showErrorMessage("Can't save the selected directory: " + error);
        }
    }

    private static async pickConfigFile(): Promise<vscode.Uri | undefined> {
        const activeFile = vscode.window.activeTextEditor?.document.uri;
        if (activeFile?.path.endsWith(CONFIG_FILE_SUFFIX)) {
            return activeFile;
        }

        const loadedFolders = Configs.getAllTargetOptions().map((item) => item.workspaceFolder);
        const files = Configs.getWorkspaceConfigFiles().filter((file) =>
            loadedFolders.some((folder) => folder.uri.path + CONFIG_FILE_SUFFIX === file.path),
        );
        if (files.length === 0) {
            Extension.showErrorMessage("No PRO Deployer config with targets was found.");
            return undefined;
        }
        if (files.length === 1) {
            return files[0];
        }
        const picked = await vscode.window.showQuickPick(
            files.map((file) => ({
                label: vscode.workspace.getWorkspaceFolder(file)?.name ?? file.path,
                file,
            })),
            { title: "PRO Deployer: Select workspace" },
        );
        return picked?.file;
    }

    private static async pickTargetIndex(targets: { name?: string }[]): Promise<number | undefined> {
        const picked = await vscode.window.showQuickPick(
            targets.map((item, index) => ({ label: item.name ?? "Target " + (index + 1), index })),
            { title: "PRO Deployer: Select target" },
        );
        return picked?.index;
    }

    private static normalize(remotePath: string): string {
        const normalized = path.posix.normalize("/" + remotePath);
        return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    }

    private static browse(target: TargetInterface, startPath: string): Promise<string | undefined> {
        return new Promise<string | undefined>((resolve) => {
            const quickPick = vscode.window.createQuickPick<BrowserItem>();
            quickPick.ignoreFocusOut = true;
            quickPick.matchOnDescription = false;

            let current = this.normalize(startPath);
            let isLoaded = false;
            let selected: string | undefined;
            let requestId = 0;

            const load = async (remotePath: string) => {
                const id = ++requestId;
                quickPick.busy = true;
                try {
                    const entries = await target.listDir(remotePath);
                    if (id !== requestId) {
                        return;
                    }
                    current = remotePath;
                    isLoaded = true;

                    const items: BrowserItem[] = [
                        { label: "$(check) Select this directory", description: current, action: "select", path: current },
                    ];
                    if (current !== "/") {
                        items.push({ label: "$(arrow-up) ..", action: "open", path: path.posix.dirname(current) });
                    }
                    entries
                        .filter((entry) => entry.isDirectory)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .forEach((entry) =>
                            items.push({
                                label: "$(folder) " + entry.name,
                                action: "open",
                                path: path.posix.join(current, entry.name),
                            }),
                        );

                    quickPick.title = "PRO Deployer: " + target.getName() + " - " + current;
                    quickPick.value = "";
                    quickPick.items = items;
                } catch (error) {
                    if (id !== requestId) {
                        return;
                    }
                    Extension.showErrorMessage("Can't list '" + remotePath + "': " + error);
                    if (!isLoaded && remotePath !== "/") {
                        await load("/");
                        return;
                    }
                    if (!isLoaded) {
                        quickPick.hide();
                    }
                } finally {
                    if (id === requestId) {
                        quickPick.busy = false;
                    }
                }
            };

            quickPick.onDidAccept(() => {
                const item = quickPick.selectedItems[0];
                if (!item) {
                    return;
                }
                if (item.action === "select") {
                    selected = item.path;
                    quickPick.hide();
                    return;
                }
                load(item.path);
            });
            quickPick.onDidHide(() => {
                requestId++;
                quickPick.dispose();
                resolve(selected);
            });

            quickPick.title = "PRO Deployer: " + target.getName();
            quickPick.show();
            load(current);
        });
    }
}
