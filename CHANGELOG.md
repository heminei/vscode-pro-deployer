# Change Log

All notable changes to the "pro-deployer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [3.7.0]

- **breaking:** FTPS certificates are now validated by default (`secureOptions.rejectUnauthorized` defaults to `true`). Set it to `false` for servers with a self-signed certificate.
- added SFTP target option `hostFingerprint` to verify the server host key (OpenSSH `SHA256:...` or hex).
- directories are deleted over SFTP instead of `rm -rf` through a shell, so file names can no longer inject commands. FTP no longer deletes the remote root directory.
- `Delete` / `Delete From...` ask for confirmation when a directory is included.
- fixed uploads going to the targets of the active editor's workspace instead of the workspace that owns the file (multi-root).
- fixed errors on every file event in workspace folders without a valid config file.
- fixed ignored files and folders (`ignore`, `include`, `.gitignore`) being uploaded when a whole directory is created or uploaded.
- fixed directory downloads: the queue slot is released correctly, `concurrency: 1` no longer deadlocks, symlinked directories are skipped and names from the server can't escape the workspace.
- fixed queue slots that stayed busy forever when the SFTP client was missing.
- fixed listeners piling up on every connect attempt and a target that could never reconnect after a failed SFTP subsystem start.
- fixed unhandled promise rejections from fire-and-forget operations.
- fixed commands failing when invoked with a non-object argument.
- fixed `download-all-files` offering targets of other workspace folders.
- extensionless files deleted locally are now deleted on the remote even though their type can't be detected.
- repeated save events no longer queue the same file twice.
- the config file now accepts comments and trailing commas, and is reloaded when changed outside the editor or when workspace folders change.
- `.gitignore` is parsed once per change instead of on every file event, and is looked up in the folder of the file.
- removed the misleading "Keepalive request" log lines; keepalive is still handled by the connection libraries.
- removed the unneeded `path` dependency.

- added target option `preserveMtime` (FTP/SFTP, default `false`): sets the remote file modification time to the local one after upload. FTP uses the `MFMT` command and requires server support; if it is unsupported a warning is logged and the upload still succeeds (#66).

## [3.6.0]

- fixed bug: `pro-deployer.cancel-all-actions` did not stop a running directory download - it restarted a few seconds later and had to be pressed several times.
- fixed queue corruption when a task finished after the queue was canceled.
- fixed bug: directory downloads on Windows sent the local workspace path to the remote server, and downloading the `baseDir` folder itself appended the local path to the remote path (#67).

- added commands `Download (With Ignore List)`, `Download From... (With Ignore List)` and `Download All Files (Filter Ignored) From...`: ignored files are skipped and ignored directories are not traversed (#68).
- added option `respectIgnoreOnDownload` (default `false`): applies `ignore`/`include`/`checkGitignore` to directory downloads.
- added `${secret:NAME}` support for target `password` and `passphrase`, backed by the OS keychain (VS Code SecretStorage).
- added commands `Set Secret (keychain)` and `Delete Secret (keychain)`.
- passwords and passphrases are now masked in the output channel.
- config loading is unified and a config reload no longer exposes a half-loaded state.
- added remote directory browser: pick a target's `dir` from the remote file system via the `Browse remote...` CodeLens above `dir` in `.vscode/pro-deployer.json` or the `Browse Remote Directory...` command.

## [3.5.1]

- fixed redundant synchronization logic for `workspaceConfigs`.
- fixed upload-recovery behavior that triggered a spurious `mkdir .` for root-level files.
- fixed configuration reload timing so updates apply immediately after save.

## [3.5.0]

- added a new target option: `keepaliveIntervalMs` (FTP/SFTP) to send periodic keepalive packets and reduce idle disconnects.

## [3.4.0]

- added support for SSH agent authentication for SFTP targets:
  - new options: `useAuthAgent` and `authAgentPath`
  - when `authAgentPath` is not set, it falls back to `${env:SSH_AUTH_SOCK}`

## [3.3.0]

- added support for dynamic configuration variables in config values:
  - `${workspaceFolder}` - the path of the workspace folder
  - `${workspaceFolderBasename}` - the name of the workspace folder without path
  - `${userHome}` - the path of the user's home folder
  - `${pathSeparator}` - the character used to separate path components
  - `${env:VARIABLE_NAME}` - the value of an environment variable
- This allows creating reusable configurations across different workspaces (e.g., `"dir": "/var/www/${workspaceFolderBasename}"`)

## [3.2.1]

- fixed bug: `baseDir` option was not properly applied when downloading all files, causing files to be saved to incorrect local paths.
- fixed bug: ignore/include patterns now properly match dotfiles (e.g., `.env`, `.gitignore`).
- fixed bug: ignored files are now properly skipped when using the `pro-deployer.upload-all-uncommitted` command.
- improved SFTP authentication debugging with detailed logging:
  - logs private key format detection (OpenSSH new format, PEM/RSA, PEM/DSA, PEM/ECDSA, PKCS8)
  - logs authentication configuration summary (username, password/key/passphrase provided)
  - logs SSH handshake details (key exchange algorithm, server host key, ciphers)
  - logs server banner messages
- added keyboard-interactive authentication support for SFTP connections (`tryKeyboard: true`)
- improved error messages for SFTP connection failures
- added FTPS (FTP over SSL/TLS) support for FTP connections:
  - `secure: true` - enables explicit FTPS (AUTH TLS)
  - `secure: "implicit"` - enables implicit FTPS (typically port 990)
  - `secureOptions.rejectUnauthorized` - controls certificate validation (defaults to false)

## [3.2.0]

- added support for passing arguments to `pro-deployer.upload-to` command. Now you can bind specific targets to keyboard shortcuts.

## [3.1.1]

- fixed bug: Issue #43 - If file unsaved, downloading file does nothing

## [3.1.0]

- added a new command: `pro-deployer.delete` - this command allows you to delete a file or folder from the target.
- added a new command: `pro-deployer.delete-from` - this command allows you to delete a file or folder from the selected target.
- fixed bugs when upload file from non existing folder in FTP/SFTP servers.

## [3.0.1]

- fixed bug: when in one of the folders of the workspace is missing pro-deployer.json file, the extension doesn't load the configuration.

## [3.0.0]

This is beta version. Please report any bugs.

- support workspaces! Now you can have multiple Pro Deployer configurations for each workspace. The first workspace folder is used for default configuration for UI/UX settings. All other settings will be used according to the active workspace. When use `pro-deployer.upload-all-open` or `pro-deployer.download-all-files` will be uploaded/downloaded files from the selected target workspace.
- updated dependencies.
- added information messages.
- fixed small bugs.

## [2.5.1]

- fixed small bugs

## [2.5.0]

- updated dependencies
- added a new command: `pro-deployer.upload-all-uncommitted`. This command uploads all uncommitted files to the target.
- added a new menu on editor title context menu.
- added a new menu on source control changes context menu.

## [2.4.1]

- added a new option on target level: `baseDir`. This option allows you to set the base directory for the target. This option is useful when you want to upload files from a subdirectory of the project.
- added a new global option: `include`. This option allows you to specify which files/folders to include in the auto upload/delete. If this option is not specified, all files/folders will be included.

## [2.3.1]

- added a new command: `pro-deployer.download`
- added a new command: `pro-deployer.download-from`
- added a new command: `pro-deployer.download-all-files`
 added a new command: `pro-deployer.diff-with`
- rename `pro-deployer.cancel-all-uploads` to `pro-deployer.cancel-all-actions`
- move context menu commands to submenu

## [2.2.2]

- fixed bug: missing loaders on non active targets

## [2.2.1]

- fixed bug on windows ftp server: doesn't create new folders
- fixed bug double slash on file path

## [2.2.0]

- fixed auto update configurations on Windows
- fixed freeze when show multiple error messages
- performance optimizations
- UX optimizations

## [2.1.0]

- performance optimizations
- UX optimizations

## [1.3.1]

- added new option: enableStatusBarItem
- added new option: enableQuickPick
- added status bar item. Enabled by default.
- added a new command: `pro-deployer.cancel-all-uploads`
- added a new command: `pro-deployer.show-output-channel`

## [1.2.1]

- added transferDataType option
- update dependencies

## [1.1.1]

- fixed bugs
- added a new option: checkGitignore

## [1.0.1]

- fixed bugs
- implement file watcher
- added new command: `pro-deployer.upload-all-open`

## [0.9.6]

- fixed bugs when run upload command and in project missing .gitignore file

## [0.9.5]

- fixed bugs in FTP target

## [0.9.3]

- added icon

## [0.9.1]

- Initial release
