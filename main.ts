import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

const VIEW_TYPE_TERMINAL = 'terminal-view';

interface TerminalSettings {
	pythonPath: string;
	fontSize: number;
	fontFamily: string;
}

const DEFAULT_SETTINGS: TerminalSettings = {
	pythonPath: 'python3',
	fontSize: 14,
	fontFamily: 'monospace'
};

export default class TerminalPlugin extends Plugin {
	settings: TerminalSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_TERMINAL,
			(leaf) => new TerminalView(leaf, this)
		);

		// Add ribbon icon
		this.addRibbonIcon('terminal', 'Simple Terminal', () => {
			this.toggleTerminal();
		});

		// Add command to toggle terminal
		this.addCommand({
			id: 'toggle-terminal',
			name: 'Simple Terminal: Toggle',
			callback: () => {
				this.toggleTerminal();
			}
		});

		// Add command to open new terminal tab
		this.addCommand({
			id: 'open-new-terminal',
			name: 'Simple Terminal: Open new tab',
			callback: () => {
				this.openNewTerminal();
			}
		});

		// Add command to open in right sidebar
		this.addCommand({
			id: 'open-terminal-sidebar',
			name: 'Simple Terminal: Open in sidebar',
			callback: () => {
				this.openInSidebar();
			}
		});

		// Add settings tab
		this.addSettingTab(new TerminalSettingTab(this.app, this));
	}

	async toggleTerminal() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);

		if (existing.length > 0) {
			// Find the most recently active terminal
			const activeLeaf = existing.find(leaf => leaf === workspace.activeLeaf);
			if (activeLeaf) {
				// If we're already on a terminal, close all terminals
				existing.forEach(leaf => leaf.detach());
			} else {
				// Activate the most recent terminal
				const mostRecent = existing.sort((a, b) => {
					const aTime = (a.view as any).lastActiveTime || 0;
					const bTime = (b.view as any).lastActiveTime || 0;
					return bTime - aTime;
				})[0];
				workspace.setActiveLeaf(mostRecent, { focus: true });
			}
		} else {
			await this.activateTerminal();
		}
	}

	async openNewTerminal() {
		const { workspace } = this.app;
		// Create new tab in main editor area
		const leaf = workspace.getLeaf('tab');

		await leaf.setViewState({
			type: VIEW_TYPE_TERMINAL,
			active: true,
		});
		workspace.revealLeaf(leaf);
	}

	async openInSidebar() {
		const { workspace } = this.app;
		// Create in right sidebar
		const leaf = workspace.getRightLeaf(false);

		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_TERMINAL,
				active: true,
			});
			workspace.revealLeaf(leaf);
		}
	}

	async activateTerminal() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			// Create new tab in main editor area
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({
				type: VIEW_TYPE_TERMINAL,
				active: true,
			});
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TerminalView extends ItemView {
	plugin: TerminalPlugin;
	terminal: Terminal;
	fitAddon: FitAddon;
	ptyProcess: ChildProcess | null = null;
	resizeStream: NodeJS.WritableStream | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TerminalPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TERMINAL;
	}

	getDisplayText(): string {
		return 'Terminal';
	}

	getIcon(): string {
		return 'terminal';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('terminal-container');

		// Create terminal
		this.terminal = new Terminal({
			fontSize: this.plugin.settings.fontSize,
			fontFamily: this.plugin.settings.fontFamily,
			theme: {
				background: '#202020',
				foreground: '#dcddde',
				cursor: '#7c9dff',
				cursorAccent: '#202020',
				selectionBackground: '#3d4b5c',
				black: '#1a1a1a',
				red: '#e06c75',
				green: '#98c379',
				yellow: '#d19a66',
				blue: '#7c9dff',
				magenta: '#b392ef',
				cyan: '#56b6c2',
				white: '#dcddde',
				brightBlack: '#5c6370',
				brightRed: '#e88388',
				brightGreen: '#a6d189',
				brightYellow: '#e5c07b',
				brightBlue: '#99b3ff',
				brightMagenta: '#c8adff',
				brightCyan: '#7dd5dd',
				brightWhite: '#f2f3f5'
			},
			cursorBlink: true,
			rows: 24,
			cols: 80
		});

		this.fitAddon = new FitAddon();
		this.terminal.loadAddon(this.fitAddon);
		this.terminal.loadAddon(new WebLinksAddon());

		this.terminal.open(container as HTMLElement);
		this.fitAddon.fit();

		// Start PTY process
		this.startPtyProcess();

		// Handle resize
		const resizeObserver = new ResizeObserver(() => {
			this.fitAddon.fit();
			// Send new size to PTY
			this.sendResize();
		});
		resizeObserver.observe(container);

		// Terminal data handler
		this.terminal.onData((data) => {
			if (this.ptyProcess && !this.ptyProcess.killed) {
				this.ptyProcess.stdin?.write(data);
			}
		});
	}

	startPtyProcess() {
		const vaultPath = (this.app.vault.adapter as any).basePath;
		// Get the plugin directory path
		const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'simple-terminal');
		const helperPath = path.join(pluginDir, 'pty-helper.py');

		console.log('Terminal: Starting PTY with:', this.plugin.settings.pythonPath, helperPath);

		// Set up environment
		const env = { ...process.env };
		env['TERM'] = 'xterm-256color';
		env['COLORTERM'] = 'truecolor';

		// Spawn Python PTY helper with 4 stdio streams
		// [0: stdin, 1: stdout, 2: stderr, 3: resize control]
		this.ptyProcess = spawn(this.plugin.settings.pythonPath, [helperPath], {
			cwd: vaultPath,
			env: env,
			stdio: ['pipe', 'pipe', 'pipe', 'pipe']
		});

		console.log('Terminal: PTY process spawned, PID:', this.ptyProcess.pid);

		// Store the resize stream (file descriptor 3)
		this.resizeStream = (this.ptyProcess.stdio[3] as NodeJS.WritableStream);

		// Send initial terminal size
		this.sendResize();

		this.ptyProcess.on('error', (err) => {
			console.error('Terminal: PTY process error:', err);
			this.terminal.write(`\r\n\x1b[31mProcess error: ${err.message}\x1b[0m\r\n`);
		});

		if (this.ptyProcess.stdout) {
			this.ptyProcess.stdout.on('data', (data) => {
				this.terminal.write(data);
			});
		}

		if (this.ptyProcess.stderr) {
			this.ptyProcess.stderr.on('data', (data) => {
				console.error('Terminal: PTY stderr:', data.toString());
				this.terminal.write(`\r\n\x1b[31mError: ${data.toString()}\x1b[0m\r\n`);
			});
		}

		this.ptyProcess.on('exit', (code) => {
			console.log('Terminal: PTY process exited with code', code);
			this.terminal.write(`\r\n\x1b[33mProcess exited with code ${code}\x1b[0m\r\n`);
		});
	}

	sendResize() {
		if (this.resizeStream && this.terminal) {
			const rows = this.terminal.rows;
			const cols = this.terminal.cols;
			// Send in format "ROWSxCOLUMNS\n"
			this.resizeStream.write(`${rows}x${cols}\n`);
			console.log(`Terminal: Sent resize ${rows}x${cols}`);
		}
	}

	async onClose() {
		if (this.ptyProcess && !this.ptyProcess.killed) {
			this.ptyProcess.kill();
		}
		if (this.terminal) {
			this.terminal.dispose();
		}
	}
}

class TerminalSettingTab extends PluginSettingTab {
	plugin: TerminalPlugin;

	constructor(app: App, plugin: TerminalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Python path')
			.setDesc('Path to Python executable (python3, python, or full path)')
			.addText(text => text
				.setPlaceholder('python3')
				.setValue(this.plugin.settings.pythonPath)
				.onChange(async (value) => {
					this.plugin.settings.pythonPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Font size')
			.setDesc('Terminal font size')
			.addText(text => text
				.setPlaceholder('14')
				.setValue(String(this.plugin.settings.fontSize))
				.onChange(async (value) => {
					const size = parseInt(value);
					if (!isNaN(size)) {
						this.plugin.settings.fontSize = size;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Font family')
			.setDesc('Terminal font family')
			.addText(text => text
				.setPlaceholder('monospace')
				.setValue(this.plugin.settings.fontFamily)
				.onChange(async (value) => {
					this.plugin.settings.fontFamily = value;
					await this.plugin.saveSettings();
				}));
	}
}
