# PRO Deployer - AI Coding Agent Instructions

## Project Overview
VS Code extension for concurrent SFTP/FTP file deployment with multi-workspace support. Key differentiator: **queue-based concurrent operations** for fast bulk transfers.

## Architecture

### Core Components
- **Extension (`src/extension.ts`)**: Main entry point, command registration, file watchers, and UI integration
- **Targets System (`src/targets/`)**: Abstract `Target` base class → `FTP`/`SFTP` implementations with connection pooling
- **Queue (`src/Queue.ts`)**: Custom EventEmitter-based task queue with configurable concurrency (default: 5)
- **Configs (`src/configs.ts`)**: Multi-workspace configuration manager with per-workspace `.vscode/pro-deployer.json`
- **FileSystemProvider (`src/fileSystemProvider.ts`)**: Virtual FS (`pro-deployer-fs://`) for remote diff operations

### Data Flow
1. File events (save/delete) or commands trigger → `Extension.isUriIgnored()` checks ignore/include patterns
2. Active targets retrieved via `Targets.getActive()` (filters by `activeTargets` + current workspace)
3. Each target gets `QueueTask` pushed to its queue → auto-starts if `queue.autostart = true`
4. Queue emits `task.success`/`task.error` → updates status bar and shows quick pick dialogs if `enableQuickPick: true`

### Multi-Workspace Support
**Critical**: Each workspace folder can have its own config at `{workspaceFolder}/.vscode/pro-deployer.json`
- `Configs.workspaceConfigs` maps config file paths to config objects
- `Extension.getActiveWorkspaceFolder()` resolves based on active editor → falls back to first workspace
- Target instances are scoped to workspace folders via `Target.getWorkspaceFolder()`

## Key Patterns

### Target Connection Management
```typescript
// Lazy connection pattern used everywhere
target.connect(() => {
    target.upload(uri); // Only executes after connected
}, errorCallback);
```
Connections auto-reconnect on close/end events. Check `isConnecting` to prevent duplicate connections.

### Path Resolution with baseDir
```typescript
Targets.getRelativePath(targetConfig, uri)
```
Handles `baseDir` option: allows uploading from project subdirectory by stripping base path prefix before remote path construction.

### Directory Creation Pattern
Both FTP/SFTP use `creatingDirectories: Map<string, Promise<string>>` to prevent race conditions when multiple files need the same parent directory created concurrently.

### Error Handling Convention
- Log to output channel: `Extension.appendLineToOutputChannel("[ERROR][SFTP] ...")`
- Show user errors: `Extension.showErrorMessage()` (rate-limited to prevent spam)
- Queue errors emit `task.error` event, don't throw

## Development Workflows

### Build & Watch
```bash
npm run watch  # Starts TypeScript compiler in watch mode
```
Or use VS Code task: "npm: watch" (default build task)

### Testing Changes
1. Press F5 in VS Code → launches Extension Development Host
2. Create test config: `PRO Deployer: Generate Config File` command
3. Check "PRO Deployer" output channel for detailed logs

### Config Schema
Config file location: `.vscode/pro-deployer.json` in each workspace folder
```typescript
{
    uploadOnSave: boolean,      // Auto-upload on file save
    autoDelete: boolean,        // Auto-delete on file delete
    concurrency: number,        // Max parallel operations per target
    activeTargets: string[],    // Target names to use for auto-operations
    ignore: string[],          // Micromatch patterns (relative to workspace)
    include: string[],         // Optional: whitelist patterns (empty = all)
    checkGitignore: boolean,   // Parse .gitignore for ignore rules
    respectIgnoreOnDownload: boolean, // Apply ignore rules to directory downloads (default false)
    targets: [{
        name: string,
        type: "ftp" | "sftp",
        baseDir: string        // Upload files FROM this subdir (e.g., "/dist")
    }]
}
```

## Important Gotchas

1. **URI Scheme Filtering**: Files with `scheme: "git"` are always ignored (see `Extension.isUriIgnored()`)

2. **Status Bar Updates**: Require polling via `setInterval` when queue is active (`statusBarCheckTimer`)

3. **FileSystemWatcher Events**: `onDidChange` fires on both modify AND create in some cases - handle idempotently

4. **Default Ports**: FTP defaults to 21, SFTP to 22 if not specified in config

5. **Transfer Data Type**: FTP supports `transferDataType: "binary" | "ascii"` (default: binary). SFTP always binary.

6. **SSH Keys**: SFTP `privateKey` path is read synchronously on connect - verify file exists before attempting connection

7. **Workspace Folder Resolution**: Commands like `upload-all-open` and `download-all-files` filter files by target's workspace folder to prevent cross-workspace operations

8. **Secrets**: `${secret:NAME}` in `password`/`passphrase` is resolved asynchronously by `SecretManager` (VS Code SecretStorage) in `Configs.resolveSecrets()`, after the sync `VariableResolver`. Never log configs with `JSON.stringify`; use `Configs.stringifyRedacted()`. Clear-text passwords must keep working.

## Extension Points

### Adding New Target Types
1. Implement `TargetInterface` in `src/targets/`
2. Add enum value to `TargetTypes` in `Interfaces.ts`
3. Register in `Targets.getTargetInstance()` switch statement
4. Follow queue-based upload/download pattern from SFTP/FTP

### Custom Commands
All commands follow pattern:
```typescript
vscode.commands.registerCommand("pro-deployer.{action}", (...args) => {
    // Extract URIs from context menu args
    // Show quick pick if target selection needed
    // Call target.connect() → target.{action}()
});
```

## Dependencies
- `ssh2`: SFTP client (note: uses callback-based API, not promises)
- `ftp`: FTP client with custom event emitters
- `micromatch`: Glob pattern matching for ignore/include
- `gitignore-parser`: Optional .gitignore integration

## Debugging Tips
- Set `APP_MODE=dev` env var to auto-show output channel on activation
- Queue events (`start`, `end`, `task.success`, `task.error`) are logged - use them for debugging flow
- Status bar item shows pending task count and last operation - check `tooltipText` variable
