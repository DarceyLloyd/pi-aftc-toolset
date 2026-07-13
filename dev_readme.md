If cloning to work on this project without working on it directly from the install location cd into the folder you clone the repo into and run pi install .
This will create a .pi dir in the dir which will allow it to load when you run pi from that folder.
NOTE: The extension will not appear unless linked to in the users .pi/settings.json file or installed when working from other directories.

Linkage in settings.json example

{
  "theme": "aftc-orange-viz",
  "lastChangelogVersion": "0.80.6",
  "defaultProvider": "minimax",
  "defaultModel": "MiniMax-M3",
  "defaultThinkingLevel": "medium",
  "packages": [
    "npm:pi-chrome",
    "npm:@gogomi/pi-windows-shell",
    "w://dev//pi-aftc-toolset"
  ],
  "terminal": {
    "showTerminalProgress": true
  },
  "steeringMode": "all",
  "hideThinkingBlock": false,
  "enableInstallTelemetry": true,
  "defaultProjectTrust": "always"
}