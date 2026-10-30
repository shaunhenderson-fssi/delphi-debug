import * as vscode from 'vscode';
import { DelphiMapParser } from './mapParser';
import * as path from "path";

export function parseRuntimeAddress(input: string): number | undefined {
	const match = /^(?:[0-9A-F]{4}:)?(?:0x)?([0-9A-F]{1,8})$/i.exec(input.trim());
	if (!match) {
		return undefined;
	}

	const address = parseInt(match[1], 16);
	return address <= 0xFFFFFFFF ? address : undefined;
}

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

	const configurationProvider: vscode.DebugConfigurationProvider = {
		resolveDebugConfiguration: async (folder, configuration) => {
			/*
			Example .vscode/launch.json configuration:
			{
				"version": "0.2.0",
				"configurations": [
					{
						"type": "delphi",
						"request": "launch",
						"name": "Debug Delphi program",
						"program": "C:\\apps\\inca\\bin\\p1.exe",
						"mapFile": "C:\\apps\\inca\\bin\\p1.map",
						"adapter": "C:/path/to/delphi-debug-adapter.exe",
						"stopOnEntry": true
					}
				]
			}
			*/

			const resolved = { ...configuration };
			if (!resolved.type) {
				resolved.type = 'delphi';
			}
			if (!resolved.request) {
				resolved.request = 'launch';
			}
			if (!resolved.name) {
				resolved.name = 'Debug Delphi program';
			}

			if (!resolved.program) {
				const executables = await vscode.workspace.findFiles('**/*.exe');
				const selected = executables.length === 1
					? executables[0]
					: await vscode.window.showQuickPick(
						executables.map(file => ({
							label: vscode.workspace.asRelativePath(file, false),
							description: file.fsPath
						})),
						{ placeHolder: 'Select the Delphi executable to launch' }
					);
				resolved.program = executables.length === 1
					? (selected as vscode.Uri).fsPath
					: (selected as vscode.QuickPickItem | undefined)?.description;
			}

			if (!resolved.mapFile) {
				resolved.mapFile = await selectMapFile();
			}

			if (!resolved.program) {
				vscode.window.showErrorMessage('Delphi Debug: select an executable in the launch configuration');
				return undefined;
			}
			if (!resolved.mapFile) {
				vscode.window.showErrorMessage('Delphi Debug: select a Delphi MAP file');
				return undefined;
			}
			if (!path.isAbsolute(resolved.program)) {
				resolved.program = path.resolve(folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', resolved.program);
			}
			if (!path.isAbsolute(resolved.mapFile)) {
				resolved.mapFile = path.resolve(folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', resolved.mapFile);
			}

			output.appendLine(`Debug configuration: ${resolved.program}`);
			output.appendLine(`MAP file: ${resolved.mapFile}`);
			return resolved;
		}
	};

	const adapterDescriptorFactory: vscode.DebugAdapterDescriptorFactory = {
		createDebugAdapterDescriptor(session) {
			const adapter = session.configuration.adapter;
			if (typeof adapter !== 'string' || adapter.length === 0) {
				throw new Error(
					'No Delphi debug adapter configured. Set "adapter" in launch.json to the native debugger adapter executable.'
				);
			}

			return new vscode.DebugAdapterExecutable(
				adapter,
				Array.isArray(session.configuration.adapterArgs)
					? session.configuration.adapterArgs
					: []
			);
		}
	};

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

					/*
					const fileName = editor.document.uri.fsPath
						.split(/[\\/]/)
						.pop() ?? '';
					*/
					const fileName = path.basename(editor.document.uri.fsPath);
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
					const message = `0x${address.toString(16)} => ${symbol?.symbol ?? '<unknown symbol>'}`;

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

					/*
					const fileName = editor.document.uri.fsPath
						.split(/[\\/]/)
						.pop() ?? '';
					*/
					const fileName = path.basename(editor.document.uri.fsPath);
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
					const symbolName = typeof symbol === 'string' ? symbol : symbol.symbol;
					const message = `${sourceLine}\nRVA: ${rva}\nSymbol: ${symbolName}`;

					output.appendLine(message);
					vscode.window.showInformationMessage(message);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					output.appendLine(`delphi-debug.currentLineInfo failed: ${message}`);
					vscode.window.showErrorMessage(`Delphi Debug failed: ${message}`);
				}
			}
		);

	const goToRuntimeAddress =
		vscode.commands.registerCommand(
			'delphi-debug.goToRuntimeAddress',
			async () => {
				try {
					const addressInput = await vscode.window.showInputBox({
						prompt: 'Enter a Delphi runtime address',
						placeHolder: '00FD72AC',
						validateInput: value => parseRuntimeAddress(value) === undefined
							? 'Enter a hexadecimal address, optionally prefixed by 0x or a segment'
							: undefined
					});
					if (addressInput === undefined) {
						return;
					}

					const address = parseRuntimeAddress(addressInput);
					if (address === undefined) {
						vscode.window.showErrorMessage('Invalid runtime address');
						return;
					}

					const parser = await getParser();
					const lineMapping = parser.findLineByAddress(address);
					if (!lineMapping) {
						const message = `No source mapping found for 0x${address.toString(16).toUpperCase().padStart(8, '0')}`;
						output.appendLine(message);
						vscode.window.showErrorMessage(message);
						return;
					}

					const symbol = parser.findSymbolByAddress(address)?.symbol ?? '<unknown symbol>';
					output.appendLine(`${lineMapping.file}:${lineMapping.line}`);
					output.appendLine(symbol);

					const pascalFiles = await vscode.workspace.findFiles('**/*.pas');
					const matchingFile = pascalFiles.find(file =>
						path.basename(file.fsPath).toLowerCase() === lineMapping.file.toLowerCase()
					);

					if (!matchingFile) {
						const message = `${lineMapping.file}:${lineMapping.line}\n${symbol}`;
						vscode.window.showWarningMessage(`${message}\nSource file was not found in the workspace`);
						return;
					}

					const document = await vscode.workspace.openTextDocument(matchingFile);
					const editor = await vscode.window.showTextDocument(document);
					const sourceLine = Math.min(Math.max(lineMapping.line - 1, 0), document.lineCount - 1);
					editor.selection = new vscode.Selection(sourceLine, 0, sourceLine, 0);
					editor.revealRange(
						new vscode.Range(sourceLine, 0, sourceLine, 0),
						vscode.TextEditorRevealType.InCenter
					);

					vscode.window.showInformationMessage(`${lineMapping.file}:${lineMapping.line}\n${symbol}`);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					output.appendLine(`delphi-debug.goToRuntimeAddress failed: ${message}`);
					vscode.window.showErrorMessage(`Delphi Debug failed: ${message}`);
				}
			}
		);

	context.subscriptions.push(
		delphiDebug,
		currentLineInfo,
		goToRuntimeAddress,
		selectMap,
		vscode.debug.registerDebugConfigurationProvider('delphi', configurationProvider),
		vscode.debug.registerDebugAdapterDescriptorFactory('delphi', adapterDescriptorFactory)
	);
}

export function deactivate() { }