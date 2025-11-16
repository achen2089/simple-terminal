# Simple Terminal - Obsidian Plugin

A fully functional, integrated terminal emulator for Obsidian that provides native shell access within your vault. Built with xterm.js and a Python PTY helper for cross-platform terminal support.

## Features

- **Full Terminal Emulation**: Complete xterm.js-powered terminal with 256-color support
- **Multiple Terminal Instances**: Open terminals in tabs or sidebars
- **Adaptive Styling**: Automatic styling based on location (main area vs sidebar)
- **Proper PTY Support**: Uses Python's `pty` module for authentic shell experience
- **Dynamic Resizing**: Terminals resize correctly when moved or window changes
- **Configurable**: Customizable Python path, font size, and font family

## Architecture

### Overview

The plugin uses a hybrid architecture combining TypeScript (Obsidian plugin) and Python (PTY management):

```
┌─────────────────────────────────────────────┐
│         Obsidian (Electron/Node.js)         │
│  ┌───────────────────────────────────────┐  │
│  │     TerminalView (TypeScript)         │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │     xterm.js Terminal UI        │  │  │
│  │  └─────────────────────────────────┘  │  │
│  │              ↕ (writes/reads)         │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │   Node.js Child Process         │  │  │
│  │  │   (pty-helper.py)               │  │  │
│  │  │   - stdin  (fd 0) ←─────────────┼──┼──── User input
│  │  │   - stdout (fd 1) ──────────────┼──┼───► Terminal output
│  │  │   - stderr (fd 2) ──────────────┼──┼───► Error output
│  │  │   - resize (fd 3) ←─────────────┼──┼──── Resize commands
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
                      ↕
         ┌────────────────────────┐
         │  Python PTY Helper     │
         │  (pty-helper.py)       │
         │  ┌──────────────────┐  │
         │  │  pty.fork()      │  │
         │  │  Shell Process   │  │
         │  │  (zsh/bash)      │  │
         │  └──────────────────┘  │
         └────────────────────────┘
```

### Components

#### 1. **main.ts** - Obsidian Plugin Core
- Registers the terminal view type with Obsidian
- Provides commands: Toggle, Open new tab, Open in sidebar
- Manages plugin settings and configuration
- Handles terminal lifecycle (creation, activation, cleanup)

#### 2. **TerminalView Class** - UI and Process Management
- Extends Obsidian's `ItemView` to integrate with workspace
- Creates xterm.js terminal instances with custom theming
- Spawns Python PTY helper as child process with 4 stdio streams
- Manages bidirectional communication between terminal UI and shell
- Implements resize handling via dedicated control stream
- Detects sidebar vs main area placement for adaptive styling

#### 3. **pty-helper.py** - PTY Management
- Uses Python's `pty.fork()` to create pseudo-terminal
- Spawns user's shell (respects `$SHELL` environment variable)
- Implements event-based I/O multiplexing with `selectors` module
- Handles three concurrent data streams:
  - **stdin → PTY**: User input from terminal
  - **PTY → stdout**: Shell output to terminal
  - **fd 3 → PTY**: Resize commands (format: `ROWSxCOLUMNS\n`)
- Exits with shell's exit code for proper cleanup

#### 4. **styles.css** - Terminal Styling
- Includes complete xterm.js base styles
- Custom terminal container with dark theme
- Dynamic padding applied via JavaScript based on location
- Custom scrollbar styling for better integration

## File Structure

```
simple-terminal/
├── main.ts              # Plugin entry point and view implementation
├── pty-helper.py        # Python PTY wrapper
├── styles.css           # Terminal and xterm.js styles
├── manifest.json        # Plugin metadata
├── package.json         # Node.js dependencies
├── tsconfig.json        # TypeScript configuration
├── esbuild.config.mjs   # Build configuration
└── README.md            # This file
```

## How It Works

### Terminal Creation Flow

1. **User triggers command** (toggle/new tab/sidebar)
2. **Plugin creates WorkspaceLeaf** in appropriate location
3. **TerminalView.onOpen() executes**:
   - Detects if in sidebar: `this.leaf.getRoot() !== this.app.workspace.rootSplit`
   - Sets appropriate font size and padding
   - Creates xterm.js Terminal instance
   - Loads FitAddon (auto-sizing) and WebLinksAddon (clickable URLs)
4. **Spawns Python PTY helper** with 4 stdio streams
5. **Sets up event handlers**:
   - User typing → sends to PTY stdin
   - PTY stdout → writes to xterm.js display
   - Window resize → sends dimensions to resize stream
6. **Terminal becomes interactive**

### Communication Protocol

#### Data Flow (stdin/stdout)
```
User types "ls" → xterm.onData() → ptyProcess.stdin.write()
                                           ↓
                                    Python helper reads
                                           ↓
                                    Writes to PTY master
                                           ↓
                                    Shell executes "ls"
                                           ↓
                                    Shell writes output
                                           ↓
                                    Python reads from PTY
                                           ↓
                                    Writes to stdout
                                           ↓
ptyProcess.stdout.on('data') → terminal.write() → User sees output
```

#### Resize Protocol
```
Window resized → ResizeObserver triggers → fitAddon.fit()
                                                ↓
                                        terminal.rows/cols updated
                                                ↓
                                    resizeStream.write("24x80\n")
                                                ↓
                                    Python reads from fd 3
                                                ↓
                                    Parses "ROWSxCOLUMNS"
                                                ↓
                                    ioctl(TIOCSWINSZ) on PTY
                                                ↓
                                    Shell receives SIGWINCH
                                                ↓
                                    Terminal works at new size
```

### Styling Strategy

The plugin uses **location-aware styling**:

**Main Area Terminals**:
- Font size: 16px (configurable via settings)
- Inner padding: 8px
- Outer padding: 0 (removed via JavaScript)
- Use case: Primary work terminal

**Sidebar Terminals**:
- Font size: 12px (fixed)
- Inner padding: 6px
- Outer padding: 0
- Use case: Monitoring, quick commands

Detection method:
```typescript
const isInSidebar = this.leaf.getRoot() !== this.app.workspace.rootSplit;
```

Styling is applied dynamically in `onOpen()` by:
1. Setting terminal font size during construction
2. Applying padding to `.xterm` element after rendering

## Development

### Setup

```bash
# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build
```

### Prerequisites

- **Node.js**: v16 or higher
- **Python 3**: For PTY helper (uses `pty` module, Unix-only)
- **Obsidian**: Latest version

### Project Dependencies

**TypeScript/Node.js**:
- `@xterm/xterm`: Terminal emulator core
- `@xterm/addon-fit`: Auto-sizing addon
- `@xterm/addon-web-links`: URL detection and linking
- `obsidian`: Obsidian API types

**Python**:
- Standard library only (`pty`, `os`, `selectors`, `struct`)

### Making Changes

#### Modifying Terminal Appearance

**Change color theme** (`main.ts:190-212`):
```typescript
theme: {
    background: '#202020',    // Terminal background
    foreground: '#dcddde',    // Text color
    cursor: '#7c9dff',        // Cursor color
    // ... 16 color palette
}
```

**Adjust padding** (`main.ts:191`):
```typescript
const padding = isInSidebar ? '6px' : '8px';  // Modify values here
```

**Change font sizes** (`main.ts:190`):
```typescript
const fontSize = isInSidebar ? 12 : this.plugin.settings.fontSize;
```

#### Adding Terminal Features

**Example: Add custom keybinding**

1. In `TerminalView.onOpen()`, add after terminal creation:
```typescript
this.terminal.attachCustomKeyEventHandler((event) => {
    if (event.ctrlKey && event.key === 'k') {
        // Clear terminal
        this.terminal.clear();
        return false; // Prevent default
    }
    return true; // Allow default handling
});
```

**Example: Add search functionality**

1. Install addon: `npm install @xterm/addon-search`
2. Import in `main.ts`:
```typescript
import { SearchAddon } from '@xterm/addon-search';
```
3. Load addon in `onOpen()`:
```typescript
const searchAddon = new SearchAddon();
this.terminal.loadAddon(searchAddon);
```

#### Modifying PTY Behavior

**Change default shell** (`pty-helper.py:36`):
```python
shell = _environ.get('SHELL', '/bin/zsh')  # Change default here
```

**Add environment variables** (`main.ts:253-255`):
```typescript
const env = { ...process.env };
env['TERM'] = 'xterm-256color';
env['MY_CUSTOM_VAR'] = 'value';  // Add here
```

**Modify initial directory** (`main.ts:260`):
```typescript
this.ptyProcess = spawn(this.plugin.settings.pythonPath, [helperPath], {
    cwd: vaultPath,  // Change to different directory
    // ...
});
```

#### Adding Settings

1. **Update interface** (`main.ts:10-14`):
```typescript
interface TerminalSettings {
    pythonPath: string;
    fontSize: number;
    fontFamily: string;
    myNewSetting: boolean;  // Add here
}
```

2. **Add default value** (`main.ts:16-20`):
```typescript
const DEFAULT_SETTINGS: TerminalSettings = {
    // ...
    myNewSetting: true,  // Add default
};
```

3. **Add UI control** in `TerminalSettingTab.display()`:
```typescript
new Setting(containerEl)
    .setName('My Setting')
    .setDesc('Description here')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.myNewSetting)
        .onChange(async (value) => {
            this.plugin.settings.myNewSetting = value;
            await this.plugin.saveSettings();
        }));
```

### Testing Changes

1. **Build**: `npm run build`
2. **Reload Obsidian**: Ctrl/Cmd + R or restart
3. **Open terminal**: Use ribbon icon or command palette
4. **Check console**: Ctrl/Cmd + Shift + I for dev tools

### Debugging

**Enable verbose logging**:

Add to `startPtyProcess()`:
```typescript
console.log('Terminal: Starting PTY with:', this.plugin.settings.pythonPath, helperPath);
console.log('Terminal: PTY process spawned, PID:', this.ptyProcess.pid);
```

**Monitor Python helper**:

Add to `pty-helper.py`:
```python
import sys
sys.stderr.write(f"PTY: Shell started: {shell}\n")
sys.stderr.flush()
```

**Common issues**:
- **PTY not found**: Check Python path in settings
- **Terminal not displaying**: Check console for xterm.js errors
- **Resize not working**: Verify resize stream (fd 3) is writable
- **Colors wrong**: Check `TERM` and `COLORTERM` environment variables

## Design Decisions

### Why Python PTY Helper?

**Rejected approach**: node-pty (native Node.js addon)
- ❌ Requires C++ compilation on installation
- ❌ Platform-specific build issues
- ❌ Maintenance burden with Node.js version changes

**Chosen approach**: Python helper script
- ✅ Python's `pty` module is battle-tested
- ✅ No native compilation required
- ✅ Easy to debug and modify
- ✅ Cross-platform (Unix systems have Python)
- ✅ Based on proven implementation (obsidian-terminal)

### Why 4 stdio streams?

Standard approach is 3 streams (stdin/stdout/stderr). We added a 4th for resize:

**Alternative**: Send resize via stdin with special escape sequences
- ❌ Conflicts with user input
- ❌ Requires parsing/filtering
- ❌ Race conditions possible

**Our approach**: Dedicated resize stream (fd 3)
- ✅ Clean separation of concerns
- ✅ No parsing overhead
- ✅ Simple protocol: `ROWSxCOLUMNS\n`
- ✅ Immediate, reliable resize

### Why Location-Based Styling?

Users have different needs for sidebar vs main area:
- **Sidebar**: Compact, monitoring, less important
- **Main area**: Primary workspace, needs readability

Dynamic detection allows single codebase to optimize for both use cases.

## Future Enhancements

Potential improvements:

- [ ] **Multiple shell profiles**: Different shells per terminal
- [ ] **Session persistence**: Save/restore terminal state
- [ ] **Split panes**: Multiple shells in one view
- [ ] **Custom themes**: User-defined color schemes
- [ ] **Ligature support**: Better font rendering
- [ ] **Search functionality**: Find in terminal output
- [ ] **Tab completion hints**: Visual autocomplete
- [ ] **Windows support**: Use ConPTY or similar

## Contributing

When making changes:

1. Follow existing code style (tabs, TypeScript strict mode)
2. Test in both sidebar and main area
3. Verify resize works correctly
4. Check with different shells (bash, zsh, fish)
5. Update README if adding features

## License

MIT

## Credits

- Based on architecture from [obsidian-terminal](https://github.com/polyipseity/obsidian-terminal)
- Uses [xterm.js](https://xtermjs.org/) for terminal emulation
- Built for [Obsidian](https://obsidian.md/)
