import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DelphiMapParser } from '../mapParser';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('findNearestAddress returns the mapped line', async () => {
		const mapFile = path.join(os.tmpdir(), `delphi-debug-${process.pid}.map`);
		fs.writeFileSync(mapFile, [
			'Line numbers for Unit1(Unit1.pas) segment .text',
			'  629 0001:00FD72AC',
			'  631 0001:00FD72B0'
		].join('\n'));

		try {
			const parser = new DelphiMapParser();
			await parser.load(mapFile);

			assert.deepStrictEqual(
				parser.findNearestAddress('Unit1.pas', 630),
				{
					requestedLine: 630,
					mappedLine: 629,
					address: 0x00FD72AC
				}
			);
		} finally {
			fs.unlinkSync(mapFile);
		}
	});
});
