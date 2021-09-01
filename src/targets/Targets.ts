import * as vscode from "vscode";
import { Configs } from "../configs";
import { Extension } from "../extension";
import { FTP } from "./FTP";
import { SFTP } from "./SFTP";
import { TargetInterface, TargetOptionsInterface, TargetTypes } from "./Interfaces";

export class Targets {
    private static items: TargetInterface[] = [];

    public static add(target: TargetInterface) {
        this.items.push(target);
    }

    public static upload(uri: vscode.Uri): Promise<vscode.Uri[]> {
        let promises: Promise<vscode.Uri>[] = [];
        Targets.getActive().forEach((target) => {
            let promise = target.upload(uri);
            promise.catch((error) => {
                Extension.showErrorMessage(
                    target.getName() + " => Can't upload file: " + uri.path + ". Details: " + error
                );
            });
            promises.push(promise);
        });

        const promise = Promise.all(promises);
        return promise;
    }

    public static delete(uri: vscode.Uri): Promise<vscode.Uri[]> {
        let promises: Promise<vscode.Uri>[] = [];
        Targets.getActive().forEach((target) => {
            let promise = target.delete(uri);
            promise.catch((error) => {
                Extension.showErrorMessage(
                    target.getName() + " => Can't delete file: " + uri.path + ". Details: " + error
                );
            });
            promises.push(promise);
        });

        const promise = Promise.all(promises);
        return promise;
    }

    public static deleteDir(uri: vscode.Uri): Promise<vscode.Uri[]> {
        let promises: Promise<vscode.Uri>[] = [];
        Targets.getActive().forEach((target) => {
            let promise = target.deleteDir(uri);
            promise.catch((error) => {
                Extension.showErrorMessage(
                    target.getName() + " => Can't delete dir: " + uri.path + ". Details: " + error
                );
            });
            promises.push(promise);
        });

        const promise = Promise.all(promises);
        return promise;
    }

    public static destroyAllTargets() {
        Targets.items.forEach((target) => {
            target.destroy();
        });
        Targets.items = [];
    }

    public static getActive() {
        return Targets.items.filter((target) => {
            let isActive = Configs.getConfigs().activeTargets?.indexOf(target.getName()) !== -1;
            return isActive;
        });
    }

    public static getItems() {
        return Targets.items;
    }

    public static findByName(name: string): TargetInterface {
        let targets = Targets.items.filter((target) => {
            return target.getName().indexOf(name) !== -1;
        });

        return targets[0];
    }

    public static getTargetInstance(targetConfig: TargetOptionsInterface): TargetInterface | null {
        switch (targetConfig.type) {
            case TargetTypes.ftp:
                if (!targetConfig.port) {
                    targetConfig.port = 21;
                }
                return new FTP(targetConfig);
            case TargetTypes.sftp:
                if (!targetConfig.port) {
                    targetConfig.port = 22;
                }
                return new SFTP(targetConfig);
            default:
                Extension.showErrorMessage("[PRO Deployer] Target '" + targetConfig.name + "' have invalid type");
                break;
        }

        return null;
    }
}
