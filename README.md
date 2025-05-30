# pro-deployer

PRO Deployer - Simple and powerful SFTP/FTP deployer. Support **concurrency** uploading or delete files (**very fast uploading and deleting files or folders**).

## Features

- multiple targets
- switchable profiles
- upload on save
- auto-delete files or folders
- concurrency upload and delete files
- ignore list
- add `Upload` and `Upload to` buttons to a context menu
- support SSH keys
- support auto upload and remove files changed on disk, e.g triggered by another application
- support `binary` and `ascii` data transfer types
- support status bar item
- support quick pick dialog
- download files or folders from targets
- delete files or folders from targets
- diff tool: compare local file with remote file
- upload all open files
- upload all uncommitted files
- support workspaces! Now you can have multiple Pro Deployer configurations for each workspace. The first workspace folder is used for default configuration for UI/UX settings. All other settings will be used according to the active workspace. When use `pro-deployer.upload-all-open` or `pro-deployer.download-all-files` will be uploaded/downloaded files from the selected target workspace.

## Donation

If you like this extension, you could become a backer or sponsor via **[PayPal](https://www.paypal.com/paypalme/hemineibg1)**. Any amount is welcome. It will encourage me to make this extension better and better!

## Usage

1. Ctrl+Shift+P on Windows/Linux or Cmd+Shift+P on Mac open command palette, run `PRO Deployer: Generate Config File`.
2. Now you should have a new menu item `PRO Deployer` in the context menu of the file explorer or in opened files. Also, you can run commands from the command palette. If you is enabled `uploadOnSave` option, on file save will be uploaded automatically.
3. Enjoy.

## Keyboard Shortcuts

1. `Alt+U` - upload file
2. `Alt+D` - download file

## Example Configs

Config file location: `${workspaceFolder}/.vscode/pro-deployer.json`

```js
{
    "enableStatusBarItem": true, //enable extension status bar item
    "enableQuickPick": true, //enable quick pick when upload/error occurs
    "uploadOnSave": true, //on file change will be uploaded to active targets
    "autoDelete": true, //on file delete will be deleted to active targets
    "checkGitignore": false, //skip files that are ignored in .gitignore
    "activeTargets": [
        "My SFTP"
    ],
    "concurrency": 5, //maximum number of concurrent actions (upload/delete)
    "ignore": [
        ".git/**/*",
        ".vscode/**/*"
    ],
    "include": [], // This option allows you to specify which files/folders to include in the auto upload/delete. If this option is not specified, all files/folders will be included.
    "targets": [
        {
            "name": "My SFTP",
            "type": "sftp",
            "host": "localhost",
            "port": 22,
            "user": "admin",
            "password": "123456",
            "dir": "/public_html",
            "baseDir": "/", //This option is useful when you want to upload files from a subdirectory of the project
            "privateKey": null,
            "passphrase": null
        },
        {
            "name": "My FTP",
            "type": "ftp",
            "host": "localhost",
            "port": 21,
            "user": "admin",
            "password": "123456",
            "dir": "/public_html",
            "baseDir": "/", //This option is useful when you want to upload files from a subdirectory of the project
            "transferDataType": "binary"
        }
    ]
}

```

## Extension Commands

This extension contributes the following commands:

- `pro-deployer.generate-config-file`: auto generate config file
- `pro-deployer.upload`: upload file or folder
- `pro-deployer.upload-to`: upload file or folder to selected target
- `pro-deployer.download`: download file or folder
- `pro-deployer.download-from`: download file or folder from selected target
- `pro-deployer.delete`: delete file or folder from active targets
- `pro-deployer.delete-from`: delete file or folder from selected target
- `pro-deployer.diff-with`: compare local file with remote file
- `pro-deployer.upload-all-open`: upload all open files
- `pro-deployer.show-output-channel`: show output channel of PRO Deployer
- `pro-deployer.cancel-all-actions`: stop all actions (uploads, downloads, deletes) and remove all actions from queue
- `pro-deployer.upload-all-uncommitted`: upload all uncommitted files
