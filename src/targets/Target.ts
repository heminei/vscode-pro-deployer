import * as vscode from "vscode";
import EventEmitter = require("events");

export abstract class Target extends EventEmitter {
    constructor(private workspaceFolder: vscode.WorkspaceFolder) {
        super();
    }

    public getWorkspaceFolder(): vscode.WorkspaceFolder {
        return this.workspaceFolder;
    }
}
