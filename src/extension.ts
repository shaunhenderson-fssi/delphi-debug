import * as vscode from 'vscode';
import { DelphiMapParser } from './mapParser';

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel("Delphi Debug");
	context.subscriptions.push(output);
	const selectedMapKey = 'delphi-debug.selectedMapFile';
	let currentParser: DelphiMapParser | undefined;
	let currentMapFile: string | undefined;
	let loadingMapFile: string | undefined;
	let loadingParser: Promise<DelphiMapParser> | undefined;

	const selectMapFile = async (allowSaved: boolean = true): Promise<string | undefined> => {
		if (allowSaved) {
			const savedMap = context.workspaceState.get<string>(selectedMapKey);
			if (savedMap) {
				return savedMap;
			}
		}

		const mapFiles = await vscode.workspace.findFiles('**/*.map');
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const items: vscode.QuickPickItem[] = mapFiles.map(file => ({
			label: vscode.workspace.asRelativePath(file, false),
			description: file.fsPath
		}));

		items.push({
			label: '$(folder-opened) Browse for a .map file...',
			description: workspaceFolder?.uri.fsPath
		});

		const selected = await vscode.window.showQuickPick(items, {
			title: 'Select Delphi MAP file',
			placeHolder: 'Choose a .map file'
		});
		if (!selected) {
			return undefined;
		}

		if (selected.label === '$(folder-opened) Browse for a .map file...') {
			const selectedFiles = await vscode.window.showOpenDialog({
				canSelectMany: false,
				filters: {
					'Delphi MAP files': ['map'],
					'All files': ['*']
				},
				title: 'Select Delphi MAP file'
			});
			const selectedFile = selectedFiles?.[0]?.fsPath;
			if (selectedFile) {
				await context.workspaceState.update(selectedMapKey, selectedFile);
			}
			return selectedFile;
		}

		const selectedFile = selected.description;
		if (selectedFile) {
			await context.workspaceState.update(selectedMapKey, selectedFile);
		}
		return selectedFile;
	};

	const getParser = async (): Promise<DelphiMapParser> => {
		const mapFilename = await selectMapFile();

		if (!mapFilename) {
			throw new Error("No MAP file selected");
		}

		if (currentParser && currentMapFile === mapFilename) {
			return currentParser;
		}

		if (loadingParser && loadingMapFile === mapFilename) {
			return loadingParser;
		}

		if (!loadingParser || loadingMapFile !== mapFilename) {
			const parser = new DelphiMapParser();
			loadingParser = parser.load(mapFilename).then(() => {
				if (loadingMapFile === mapFilename) {
					currentParser = parser;
					currentMapFile = mapFilename;
				}
				return parser;
			}).finally(() => {
				if (loadingMapFile === mapFilename) {
					loadingParser = undefined;
					loadingMapFile = undefined;
				}
			});
			loadingMapFile = mapFilename;
		}

		return loadingParser;
	};

	const selectMap =
		vscode.commands.registerCommand(
			'delphi-debug.selectMapFile',
			async () => {
				await selectMapFile(false);
			}
		);

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

					const mapFilename = await selectMapFile();
					if (!mapFilename) {
						return;
					}
					if (!currentParser || currentMapFile !== mapFilename) {
						output.appendLine(`Loading MAP: ${mapFilename}`);
					}
					const parser = await getParser();

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
					const mapFilename = await selectMapFile();
					if (!mapFilename) {
						return;
					}
					if (!currentParser || currentMapFile !== mapFilename) {
						output.appendLine(`Loading MAP: ${mapFilename}`);
					}
					const parser = await getParser();

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

	context.subscriptions.push(delphiDebug, currentLineInfo, selectMap);
}

export function deactivate() { }