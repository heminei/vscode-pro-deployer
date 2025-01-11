import { Configs } from "../configs";
import { Extension } from "../extension";
import { FTP } from "./FTP";
import { SFTP } from "./SFTP";
import { TargetInterface, TargetOptionsInterface, TargetTypes } from "./Interfaces";
import * as vscode from "vscode";

export class Targets {
    private static items: TargetInterface[] = [];

    public static add(target: TargetInterface) {
        this.items.push(target);
    }

    public static destroyAllTargets() {
        Targets.items.forEach((target) => {
            target.destroy();
        });
        Targets.items = [];
    }

    public static getActive() {
        return Targets.items.filter((target) => {
            if (Extension.getActiveWorkspaceFolder()?.uri.path !== target.getWorkspaceFolder().uri.path) {
                return false;
            }
            let isActive = Configs.getWorkspaceConfigs().activeTargets?.indexOf(target.getName()) !== -1;
            return isActive;
        });
    }

    public static getItems() {
        return Targets.items;
    }

    public static getTargetInstance(
        targetConfig: TargetOptionsInterface,
        workspaceFolder: vscode.WorkspaceFolder
    ): TargetInterface | null {
        switch (targetConfig.type) {
            case TargetTypes.ftp:
                if (!targetConfig.port) {
                    targetConfig.port = 21;
                }
                return new FTP(targetConfig, workspaceFolder);
            case TargetTypes.sftp:
                if (!targetConfig.port) {
                    targetConfig.port = 22;
                }
                return new SFTP(targetConfig, workspaceFolder);
            default:
                Extension.showErrorMessage("[PRO Deployer] Target '" + targetConfig.name + "' have invalid type");
                break;
        }

        return null;
    }

    public static getRelativePath(targetConfig: TargetOptionsInterface, uri: vscode.Uri): string {
        let relativePath = vscode.workspace.asRelativePath(uri, false);
        let baseDir = targetConfig.baseDir ?? "/";

        if (baseDir.startsWith("/") === true) {
            baseDir = baseDir.substring(1);
        }
        if (baseDir.endsWith("/") === false) {
            baseDir = baseDir + "/";
        }
        if (relativePath.startsWith(baseDir) === true) {
            relativePath = relativePath.substring(baseDir.length);
        }

        return relativePath;
    }
}
