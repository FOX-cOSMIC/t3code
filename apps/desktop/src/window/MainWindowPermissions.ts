import * as Electron from "electron";

/**
 * Keeps the session's default, which grants every request. The one addition is
 * microphone capture on macOS. It asks the OS for consent first, so dictation gets
 * the system prompt instead of silence until the app may record.
 */
export function installMainWindowPermissions(
  webContents: Electron.WebContents,
  platform: NodeJS.Platform,
): void {
  webContents.session.setPermissionRequestHandler((requester, permission, callback, details) => {
    const wantsMicrophone =
      platform === "darwin" &&
      permission === "media" &&
      requester === webContents &&
      "mediaTypes" in details &&
      details.mediaTypes?.includes("audio") === true;
    if (!wantsMicrophone) {
      callback(true);
      return;
    }
    void Electron.systemPreferences
      .askForMediaAccess("microphone")
      .then(callback, () => callback(false));
  });
}
