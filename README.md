# pro-deployer

PRO Deployer - Simple and powerful SFTP/FTP deployer. Support concurrency upload or delete files (**very fast upload**).

## Features

-   multiple targets
-   switchable profiles
-   upload on save
-   auto delete
-   concurrency upload and delete files
-   ignore list
-   add `Upload` and `Upload to` buttons to context menu

## Usage

1. Ctrl+Shift+P on Windows/Linux or Cmd+Shift+P on Mac open command palette, run `PRO Deployer: Generate Config File`.
2. Enjoy.

## Example Configs

```js
{
    "uploadOnSave": true,
    "autoDelete": true,
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
            "dir": "/public_html"
        },
        {
            "name": "My SFTP",
            "type": "sftp",
            "host": "localhost",
            "port": 22,
            "user": "admin",
            "password": "123456",
            "dir": "/public_html"
        }
    ]
}

```

## Extension Commands

This extension contributes the following commands:

-   `pro-deployer.generate-config-file`: auto generate config file
-   `pro-deployer.upload`: upload file or folder
-   `pro-deployer.upload-to`: upload file or folder to selected target
