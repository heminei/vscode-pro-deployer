import * as vscode from "vscode";
import * as Queue from "./../Queue";

export interface ConfigsInterface {
    enableStatusBarItem?: boolean;
    enableQuickPick?: boolean;
    autoDelete?: boolean;
    uploadOnSave?: boolean;
    checkGitignore?: boolean;
    concurrency?: number;
    activeTargets?: string[];
    targets?: TargetOptionsInterface[];
    ignore: string[];
    include: string[];
}
export interface TargetOptionsInterface {
    name: string;
    type: TargetTypes;
    host: string;
    dir: string;
    baseDir?: string;
    port?: number;
    user?: string;
    password?: string;
    secure?: boolean;
    privateKey?: string;
    passphrase?: string;
    transferDataType?: "binary" | "ascii";
}

export interface TargetInterface {
    connect(cb: Function, error?: Function | undefined): void;
    upload(uri: vscode.Uri): Promise<vscode.Uri>;
    download(uri: vscode.Uri, destination?: vscode.Uri): Promise<vscode.Uri>;
    downloadDir(uri: vscode.Uri): Promise<vscode.Uri>;
    delete(uri: vscode.Uri): Promise<vscode.Uri>;
    deleteDir(uri: vscode.Uri): Promise<vscode.Uri>;
    destroy(): void;
    getName(): string;
    getQueue(): Queue.Queue<QueueTask>;
    getWorkspaceFolder(): vscode.WorkspaceFolder;
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

// export interface ReadDirPath {
//     type: string;
//     uri: vscode.Uri;
// }
