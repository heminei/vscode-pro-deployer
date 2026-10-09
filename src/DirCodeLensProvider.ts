import * as vscode from "vscode";
import * as jsonc from "jsonc-parser";

export class DirCodeLensProvider implements vscode.CodeLensProvider {
    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const root = jsonc.parseTree(document.getText());
        const targets = root && jsonc.findNodeAtLocation(root, ["targets"]);
        if (!targets || targets.type !== "array") {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];
        (targets.children ?? []).forEach((target, index) => {
            const dir = jsonc.findNodeAtLocation(target, ["dir"]);
            if (!dir) {
                return;
            }
            const range = new vscode.Range(document.positionAt(dir.offset), document.positionAt(dir.offset + dir.length));
            lenses.push(
                new vscode.CodeLens(range, {
                    title: "$(folder-opened) Browse remote...",
                    command: "pro-deployer.browse-remote-dir",
                    arguments: [document.uri, index],
                }),
            );
        });
        return lenses;
    }
}
