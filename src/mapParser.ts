import * as fs from "fs";
import * as readline from "readline";

export interface LineMapping {
	file: string;
	line: number;
	address: number;
}

export interface NearestAddressMapping {
	requestedLine: number;
	mappedLine: number;
	address: number;
}

export interface SymbolMapping {
	address: number;
	symbol: string;
}

export class DelphiMapParser {

	private sourceLookup = new Map<string, number>();
	private sourceLines = new Map<string, number[]>();
	private lineLookup = new Map<number, LineMapping>();
	private sortedLineAddresses: number[] = [];
	private symbolLookup = new Map<number, string>();
	private sortedSymbolAddresses: number[] = [];

	async load(filename: string): Promise<void> {
		this.sourceLookup.clear();
		this.sourceLines.clear();
		this.lineLookup.clear();
		this.sortedLineAddresses = [];
		this.symbolLookup.clear();
		this.sortedSymbolAddresses = [];

		const stream = fs.createReadStream(filename);

		const reader = readline.createInterface({
			input: stream,
			crlfDelay: Infinity
		});

		let currentFile = "";

		for await (const line of reader) {

			//
			// Detect:
			//
			// Line numbers for browse(browse.pas) segment .text
			//
			const lineHeader = /^Line numbers for .*?\((.+?)\)\s+segment/i.exec(line);

			if (lineHeader) {
				currentFile = lineHeader[1];
				continue;
			}

			//
			// Parse symbol lines:
			//
			// 0001:00FD72AC browse.TFormAKPPOSBrowser.FormCreate
			//
			const symbolMatch = /^\s*[0-9A-F]{4}:([0-9A-F]{8})\s+(.+)$/i.exec(line);

			if (symbolMatch) {

				const address = parseInt(symbolMatch[1], 16);

				const symbol = symbolMatch[2].trim();
				if (!this.symbolLookup.has(address)) {
					this.symbolLookup.set(address, symbol);
				}
			}

			//
			// Parse line-number mappings
			//
			if (currentFile) {
				this.parseLineNumberRow(line, currentFile);
			}
		}

		this.sortedSymbolAddresses = Array.from(this.symbolLookup.keys())
			.sort((left, right) => left - right);
		this.sortedLineAddresses = Array.from(this.lineLookup.keys())
			.sort((left, right) => left - right);

		const linesByFile = new Map<string, number[]>();
		for (const key of this.sourceLookup.keys()) {
			const separator = key.lastIndexOf(':');
			const file = key.substring(0, separator);
			const line = parseInt(key.substring(separator + 1), 10);
			const lines = linesByFile.get(file) ?? [];
			lines.push(line);
			linesByFile.set(file, lines);
		}

		for (const [file, lines] of linesByFile) {
			this.sourceLines.set(
				file,
				Array.from(new Set(lines)).sort((left, right) => left - right)
			);
		}
	}

	private parseLineNumberRow(
		line: string,
		file: string
	): void {

		//
		// Matches:
		//
		// 631 0001:00FD72AC
		//
		const regex = /(\d+)\s+[0-9A-F]{4}:([0-9A-F]{8})/gi;

		let match;

		while ((match = regex.exec(line)) !== null) {

			const sourceLine = parseInt(match[1], 10);

			const address = parseInt(match[2], 16);

			const sourceKey = `${file.toLowerCase()}:${sourceLine}`;
			if (!this.sourceLookup.has(sourceKey)) {
				this.sourceLookup.set(sourceKey, address);
			}
			if (!this.lineLookup.has(address)) {
				this.lineLookup.set(address, {
					file,
					line: sourceLine,
					address
				});
			}
		}
	}

	public findLineByAddress(
		address: number
	): LineMapping | undefined {
		const exactLine = this.lineLookup.get(address);
		if (exactLine !== undefined) {
			return exactLine;
		}

		let low = 0;
		let high = this.sortedLineAddresses.length - 1;
		let nearestAddress: number | undefined;

		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			const mappedAddress = this.sortedLineAddresses[middle];

			if (mappedAddress <= address) {
				nearestAddress = mappedAddress;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}

		return nearestAddress === undefined
			? undefined
			: this.lineLookup.get(nearestAddress);
	}

	public findAddress(
		file: string,
		line: number
	): number | undefined {
		const fileKey = file.toLowerCase();
		const exactAddress = this.sourceLookup.get(`${fileKey}:${line}`);
		if (exactAddress !== undefined) {
			return exactAddress;
		}

		const lines = this.sourceLines.get(fileKey) ?? [];
		let nearestLine: number | undefined;

		for (const mappedLine of lines) {
			if (mappedLine > line) {
				break;
			}
			nearestLine = mappedLine;
		}

		return nearestLine === undefined
			? undefined
			: this.sourceLookup.get(`${fileKey}:${nearestLine}`);
	}

	public findNearestAddress(
		file: string,
		line: number
	): NearestAddressMapping | undefined {
		const fileKey = file.toLowerCase();
		const exactAddress = this.sourceLookup.get(`${fileKey}:${line}`);
		if (exactAddress !== undefined) {
			return {
				requestedLine: line,
				mappedLine: line,
				address: exactAddress
			};
		}

		const lines = this.sourceLines.get(fileKey) ?? [];
		let nearestLine: number | undefined;
		let nearestDistance = Infinity;

		for (const mappedLine of lines) {
			const distance = Math.abs(mappedLine - line);
			if (distance < nearestDistance || (
				distance === nearestDistance &&
				mappedLine < line
			)) {
				nearestLine = mappedLine;
				nearestDistance = distance;
			}
		}

		return nearestLine === undefined
			? undefined
			: {
				requestedLine: line,
				mappedLine: nearestLine,
				address: this.sourceLookup.get(`${fileKey}:${nearestLine}`)!
			};
	}

	public findSymbolByAddress(
		address: number
	): string | undefined {
		const exactSymbol = this.symbolLookup.get(address);
		if (exactSymbol !== undefined) {
		    return exactSymbol;
		}

		let low = 0;
		let high = this.sortedSymbolAddresses.length - 1;
		let nearestAddress: number | undefined;

		while (low <= high) {
		    const middle = Math.floor((low + high) / 2);
		    const symbolAddress = this.sortedSymbolAddresses[middle];

		    if (symbolAddress <= address) {
		        nearestAddress = symbolAddress;
		        low = middle + 1;
		    } else {
		        high = middle - 1;
		    }
		}

		return nearestAddress === undefined
		    ? undefined
		    : this.symbolLookup.get(nearestAddress);
	}
}