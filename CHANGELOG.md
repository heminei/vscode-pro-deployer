# Change Log

All notable changes to the "pro-deployer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
