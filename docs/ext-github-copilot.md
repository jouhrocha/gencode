<!-- order: 16 -->

# Extension: GitHub Copilot

Unlike Visual Studio Code, in GenCode, Copilot features are disabled and not configured.

## Update your settings

In your settings, sets:
```
"chat.disableAIFeatures": false,
```

## Configure product.json

You need to create a custom `product.json` at the following location (replace `GenCode` by `GenCode - Insiders` if you use that):
- Windows: `%APPDATA%\GenCode` or `%USERPROFILE%\AppData\Roaming\GenCode`
- macOS: `~/Library/Application Support/GenCode`
- Linux: `$XDG_CONFIG_HOME/GenCode` or `~/.config/GenCode`

Then you will need to follow the guide [Running with Code OSS](https://github.com/microsoft/vscode-copilot-chat/blob/main/CONTRIBUTING.md#running-with-code-oss) with the `product.json` file created previously.
You will need to add the properties: `trustedExtensionAuthAccess` and `defaultChatAgent`.
