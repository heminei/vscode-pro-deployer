import * as vscode from "vscode";
import * as Queue from "./../Queue";

export interface ConfigsInterface {
    enableStatusBarItem?: boolean;
    enableQuickPick?: boolean;
    autoDelete?: boolean;
    uploadOnSave?: boolean;
    checkGitignore?: boolean;
    respectIgnoreOnDownload?: boolean;
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
    secure?: boolean | "implicit";
    secureOptions?: {
        rejectUnauthorized?: boolean;
    };
    privateKey?: string;
    passphrase?: string;
    transferDataType?: "binary" | "ascii";
    useAuthAgent?: boolean;
    authAgentPath?: string;

    // SFTP host key fingerprint (OpenSSH "SHA256:..." or hex); the connection is refused on mismatch
    hostFingerprint?: string;

    // Optional keepalive interval in milliseconds
    keepaliveIntervalMs?: number;

    // Set the remote file modification time to the local one after upload (FTP needs server MFMT support)
    preserveMtime?: boolean;
}

export interface TargetInterface {
    connect(cb: Function, error?: Function | undefined): void;
    upload(uri: vscode.Uri): Promise<vscode.Uri>;
    download(uri: vscode.Uri, destination?: vscode.Uri, checkIgnore?: boolean): Promise<vscode.Uri>;
    downloadDir(uri: vscode.Uri, checkIgnore?: boolean): Promise<vscode.Uri>;
    listDir(remotePath: string): Promise<RemoteDirEntry[]>;
    delete(uri: vscode.Uri, options?: { quiet?: boolean }): Promise<vscode.Uri>;
    deleteDir(uri: vscode.Uri): Promise<vscode.Uri>;
    destroy(): void;
    getName(): string;
    getQueue(): Queue.Queue<QueueTask>;
    getWorkspaceFolder(): vscode.WorkspaceFolder;
}

export interface RemoteDirEntry {
    name: string;
    isDirectory: boolean;
}

export enum TargetTypes {
    ftp = "ftp",
    sftp = "sftp",
}

export interface QueueTask extends Queue.Task<vscode.Uri> {
    uri: vscode.Uri;
    isFile: boolean;
    action: string;
    // A failure is only logged, no error popup (used for guesses that may legitimately fail)
    quiet?: boolean;
}

// export interface ReadDirPath {
//     type: string;
//     uri: vscode.Uri;
// }
