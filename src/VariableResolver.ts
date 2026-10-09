import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";

/**
 * Resolves VS Code-like variables in configuration strings.
 * Supports variables like ${workspaceFolderBasename}, ${workspaceFolder}, etc.
 *
 * @see https://code.visualstudio.com/docs/reference/variables-reference
 */
export class VariableResolver {
    /**
     * Supported variables:
     * - ${workspaceFolder} - the path of the workspace folder
     * - ${workspaceFolderBasename} - the name of the workspace folder without path
     * - ${userHome} - the path of the user's home folder
     * - ${pathSeparator} - the character used to separate path components
     */
    private static readonly variablePattern = /\$\{([^}]+)\}/g;

    /**
     * Resolve all variables in a string value
     */
    public static resolveString(value: string, workspaceFolder: vscode.WorkspaceFolder): string {
        return value.replace(this.variablePattern, (match, variable) => {
            return this.resolveVariable(variable, workspaceFolder) ?? match;
        });
    }

    /**
     * Resolve a single variable name to its value
     */
    private static resolveVariable(variable: string, workspaceFolder: vscode.WorkspaceFolder): string | undefined {
        switch (variable) {
            case "workspaceFolder":
                return workspaceFolder.uri.fsPath;
            case "workspaceFolderBasename":
                return workspaceFolder.name;
            case "userHome":
                return os.homedir();
            case "pathSeparator":
                return path.sep;
            default:
                // Check for env variables like ${env:VARIABLE_NAME}
                if (variable.startsWith("env:")) {
                    const envName = variable.substring(4);
                    return process.env[envName] ?? "";
                }
                return undefined;
        }
    }

    /**
     * Recursively resolve variables in an object (config object)
     */
    public static resolveObject<T>(obj: T, workspaceFolder: vscode.WorkspaceFolder): T {
        if (obj === null || obj === undefined) {
            return obj;
        }

        if (typeof obj === "string") {
            return this.resolveString(obj, workspaceFolder) as T;
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => this.resolveObject(item, workspaceFolder)) as T;
        }

        if (typeof obj === "object") {
            const resolved: any = {};
            for (const key of Object.keys(obj)) {
                resolved[key] = this.resolveObject((obj as any)[key], workspaceFolder);
            }
            return resolved as T;
        }

        return obj;
    }

    /**
     * Get a list of supported variables for documentation/autocomplete
     */
    public static getSupportedVariables(): { variable: string; description: string }[] {
        return [
            { variable: "${workspaceFolder}", description: "The path of the workspace folder" },
            { variable: "${workspaceFolderBasename}", description: "The name of the workspace folder without path" },
            { variable: "${userHome}", description: "The path of the user's home folder" },
            { variable: "${pathSeparator}", description: "The character used to separate path components" },
            { variable: "${env:VARIABLE_NAME}", description: "The value of an environment variable" },
            {
                variable: "${secret:NAME}",
                description: "A secret from the OS keychain (password and passphrase only)",
            },
        ];
    }
}
