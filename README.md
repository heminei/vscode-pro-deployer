# pro-deployer

PRO Deployer - Simple and powerful SFTP/FTP deployer. Support **concurrency** uploading or delete files (**very fast uploading and deleting files or folders**).

## Features

-   multiple targets
-   switchable profiles
-   upload on save
-   auto-delete files or folders
-   concurrency upload and delete files
-   ignore list
-   add `Upload` and `Upload to` buttons to a context menu
-   support SSH keys
-   support auto upload and remove files changed on disk, e.g triggered by another application
-   support `binary` and `ascii` data transfer types

## Donation

If you like this extension, you could become a backer or sponsor via **[PayPal](https://www.paypal.com/paypalme/hemineibg1)**. Any amount is welcome. It will encourage me to make this extension better and better!

## Usage

1. Ctrl+Shift+P on Windows/Linux or Cmd+Shift+P on Mac open command palette, run `PRO Deployer: Generate Config File`.
2. Enjoy.

## Example Configs

```js
{
    "uploadOnSave": true,
    "autoDelete": true,
    "checkGitignore": false, //skip files that are ignored in .gitignore
    "activeTargets": [
        "My FTP"
    ],
    "concurrency": 5,
    "ignore": [
        ".git/**/*",
        ".vscode/**/*"
    ],
    "targets": [
        {
            "name": "My FTP",
            "type": "ftp",
            "host": "localhost",
            "port": 21,
            "user": "admin",
            "password": "123456",
            "dir": "/public_html",
            "transferDataType": "binary"
        },
        {
            "name": "My SFTP",
            "type": "sftp",
            "host": "localhost",
            "port": 22,
            "user": "admin",
            "password": "123456",
            "dir": "/public_html",
            "privateKey": null,
            "passphrase": null
        }
    ]
}

```

## Extension Commands

This extension contributes the following commands:

-   `pro-deployer.generate-config-file`: auto generate config file
-   `pro-deployer.upload`: upload file or folder
-   `pro-deployer.upload-to`: upload file or folder to selected target
-   `pro-deployer.upload-all-open`: upload all open files
