import * as vscode from "vscode";
import * as Queue from "./../Queue";

export interface ConfigsInterface {
    autoDelete?: boolean;
    uploadOnSave?: boolean;
    checkGitignore?: boolean;
    concurrency?: number;
    activeTargets?: string[];
    targets?: TargetOptionsInterface[];
    ignore: string[];
}
export interface TargetOptionsInterface {
    name: string;
    type: TargetTypes;
    host: string;
    dir: string;
    url?: string;
    port?: number;
    user?: string;
    password?: string;
    secure?: boolean;
    privateKey?: string;
    passphrase?: string;
}

export interface TargetInterface {
    connect(cb: Function, error: Function): void;
    upload(uri: vscode.Uri): Promise<vscode.Uri>;
    delete(uri: vscode.Uri): Promise<vscode.Uri>;
    deleteDir(uri: vscode.Uri): Promise<vscode.Uri>;
    destroy(): void;
    getName(): string;
}

export enum TargetTypes {
    ftp = "ftp",
    sftp = "sftp",
}

export interface QueueTask extends Queue.Task<vscode.Uri> {
    uri: vscode.Uri;
    isFile: boolean;
    action: string;
}

export interface ReadDirPath {
    type: string;
    uri: vscode.Uri;
}
