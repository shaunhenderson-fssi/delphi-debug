import * as vscode from 'vscode';
import { DelphiMapParser } from './mapParser';

export function activate(context: vscode.ExtensionContext) {

	const mapFilename = "C:\\Apps\\Inca\\Bin\\p1.map";
	const output = vscode.window.createOutputChannel("Delphi Debug");
	context.subscriptions.push(output);

	const delphiDebug =
		vscode.commands.registerCommand(
			'delphi-debug.delphiDebug',
			async () => {
				try {
					output.appendLine("Running delphi-debug.delphiDebug");

					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						vscode.window.showErrorMessage("No active Pascal source file");
						return;
					}

					if (!editor.document.uri.fsPath.toLowerCase().endsWith('.pas')) {
						const message = `The active file is not a Pascal source file: ${editor.document.uri.fsPath}`;
						output.appendLine(message);
						vscode.window.showErrorMessage(message);
						return;
					}

					const fileName = editor.document.uri.fsPath
						.split(/[\\/]/)
						.pop() ?? '';
					const line = editor.selection.active.line + 1;

					output.appendLine(`Active path: ${editor.document.uri.fsPath}`);
					output.appendLine(`File: ${fileName}, line: ${line}`);
					output.appendLine(`Loading MAP: ${mapFilename}`);

					const parser =
						new DelphiMapParser();

					await parser.load(mapFilename);

					const address =
						parser.findAddress(fileName, line);

					if (address === undefined) {
						const message = `Line mapping not found for ${fileName}:${line}`;
						output.appendLine(message);
						vscode.window.showErrorMessage(message);
						return;
					}

					const symbol =
						parser.findSymbolByAddress(address);
					const message = `0x${address.toString(16)} => ${symbol}`;

					output.appendLine(message);
					vscode.window.showInformationMessage(message);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					output.appendLine(`delphi-debug.delphiDebug failed: ${message}`);
					vscode.window.showErrorMessage(`Delphi Debug failed: ${message}`);
				}
			}
		);

	const currentLineInfo =
		vscode.commands.registerCommand(
			'delphi-debug.currentLineInfo',
			async () => {
				try {
					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						vscode.window.showErrorMessage("No active Pascal source file");
						return;
					}

					if (!editor.document.uri.fsPath.toLowerCase().endsWith('.pas')) {
						vscode.window.showErrorMessage("The active file is not a Pascal source file");
						return;
					}

					const fileName = editor.document.uri.fsPath
						.split(/[\\/]/)
						.pop() ?? '';
					const line = editor.selection.active.line + 1;
					const sourceLine = editor.document.lineAt(line - 1).text;

					output.appendLine(`Current line: ${fileName}:${line}`);
					output.appendLine(`Loading MAP: ${mapFilename}`);

					const parser = new DelphiMapParser();
					await parser.load(mapFilename);

					const address = parser.findAddress(fileName, line);
					if (address === undefined) {
						const message = `Line mapping not found for ${fileName}:${line}`;
						output.appendLine(message);
						vscode.window.showErrorMessage(message);
						return;
					}

					const symbol =
						parser.findSymbolByAddress(address) ?? '<unknown symbol>';
					const rva = `0x${address.toString(16).toUpperCase().padStart(8, '0')}`;
					const message = `${sourceLine}\nRVA: ${rva}\nSymbol: ${symbol}`;

					output.appendLine(message);
					vscode.window.showInformationMessage(message);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					output.appendLine(`delphi-debug.currentLineInfo failed: ${message}`);
					vscode.window.showErrorMessage(`Delphi Debug failed: ${message}`);
				}
			}
		);

	context.subscriptions.push(delphiDebug, currentLineInfo);
}

export function deactivate() { }