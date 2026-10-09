import { Extension } from "./extension";

/** Stores secrets in VS Code SecretStorage (OS keychain) and resolves `${secret:NAME}` tokens. */
export class SecretManager {
    private static readonly keyPrefix = "pro-deployer.secret.";
    private static readonly namesKey = "pro-deployer.secretNames";
    private static readonly tokenPattern = /\$\{secret:([^}]+)\}/g;

    public static isValidName(name: string): boolean {
        return /^[^\s${}]+$/.test(name);
    }

    public static async get(name: string): Promise<string | undefined> {
        return Extension.extensionContext.secrets.get(this.keyPrefix + name);
    }

    public static async set(name: string, value: string): Promise<void> {
        await Extension.extensionContext.secrets.store(this.keyPrefix + name, value);
        const names = this.getNames();
        if (names.indexOf(name) === -1) {
            names.push(name);
            await Extension.extensionContext.globalState.update(this.namesKey, names);
        }
    }

    public static async delete(name: string): Promise<void> {
        await Extension.extensionContext.secrets.delete(this.keyPrefix + name);
        const names = this.getNames().filter((item) => item !== name);
        await Extension.extensionContext.globalState.update(this.namesKey, names);
    }

    // SecretStorage can't list keys, so names (never values) are tracked in globalState.
    public static getNames(): string[] {
        return [...Extension.extensionContext.globalState.get<string[]>(this.namesKey, [])];
    }

    /** Replaces every `${secret:NAME}` token. A missing or unreadable secret becomes an empty string. */
    public static async resolveString(
        value: string,
        getSecret: (name: string) => Thenable<string | undefined> = (name) => SecretManager.get(name),
    ): Promise<string> {
        const names = new Set<string>();
        for (const match of value.matchAll(this.tokenPattern)) {
            names.add(match[1].trim());
        }
        if (names.size === 0) {
            return value;
        }

        const resolved = new Map<string, string>();
        await Promise.all(
            [...names].map(async (name) => {
                try {
                    const secret = await getSecret(name);
                    if (secret === undefined) {
                        Extension.appendLineToOutputChannel("[WARN][Secret] Secret '" + name + "' is not set");
                    }
                    resolved.set(name, secret ?? "");
                } catch (error) {
                    Extension.appendLineToOutputChannel("[WARN][Secret] Can't read secret '" + name + "'");
                    resolved.set(name, "");
                }
            }),
        );

        return value.replace(this.tokenPattern, (_match, name: string) => resolved.get(name.trim()) ?? "");
    }
}
