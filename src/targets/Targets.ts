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
