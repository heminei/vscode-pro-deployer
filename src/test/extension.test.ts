/// <reference types="mocha" />
import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import { SecretManager } from "../SecretManager";
import { Configs } from "../configs";
import { DirCodeLensProvider } from "../DirCodeLensProvider";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests.");

    test("Sample test", () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    suite("Secrets", () => {
        const secrets: { [name: string]: string } = { a: "pass1", b: "p$ss" };
        const lookup = async (name: string) => secrets[name];

        test("plain strings are untouched", async () => {
            assert.strictEqual(await SecretManager.resolveString("123456", lookup), "123456");
            assert.strictEqual(await SecretManager.resolveString("${env:X}", lookup), "${env:X}");
        });

        test("resolves one and multiple tokens", async () => {
            assert.strictEqual(await SecretManager.resolveString("${secret:a}", lookup), "pass1");
            assert.strictEqual(
                await SecretManager.resolveString("${secret:a}-${secret:b}-${secret:a}", lookup),
                "pass1-p$ss-pass1",
            );
        });

        test("missing or failing secret becomes empty", async () => {
            assert.strictEqual(await SecretManager.resolveString("${secret:nope}", lookup), "");
            const failing = async (): Promise<string> => {
                throw new Error("keychain");
            };
            assert.strictEqual(await SecretManager.resolveString("x${secret:a}", failing), "x");
        });

        test("redaction masks password and passphrase only", () => {
            const out = Configs.stringifyRedacted({ targets: [{ user: "u", password: "secret", passphrase: "key" }] });
            assert.ok(!out.includes("secret"));
            assert.ok(!out.includes('"key"'));
            assert.ok(out.includes('"user":"u"'));
        });
    });

    suite("Remote dir browser", () => {
        const content =
            '{\n\t// keep me\n\t"targets": [\n\t\t{ "name": "a", "dir": "/" },\n\t\t{ "name": "b" },\n\t\t{ "name": "c", "dir": "/x" }\n\t]\n}';

        test("CodeLens is added for every target with dir", async () => {
            const document = await vscode.workspace.openTextDocument({ language: "jsonc", content });
            const lenses = new DirCodeLensProvider().provideCodeLenses(document);
            assert.deepStrictEqual(
                lenses.map((lens) => lens.command?.arguments?.[1]),
                [0, 2],
            );
        });

        test("setTargetDir changes only the selected dir and keeps comments", async () => {
            const document = await vscode.workspace.openTextDocument({ language: "jsonc", content });
            await Configs.setTargetDir(document.uri, 2, "/var/www");
            assert.ok(document.getText().includes("// keep me"));
            assert.ok(document.getText().includes('"dir": "/var/www"'));
            assert.ok(document.getText().includes('"dir": "/"'));
        });
    });
});
