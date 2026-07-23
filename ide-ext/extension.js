/* CodeBridge Opener — the zero-click bridge from the codebridge CLI into the
   IDE's built-in browser.

   Cursor exposes no CLI flag or URL scheme for its browser, so the CLI can't
   open it directly. This extension registers the missing door: a URI handler
   (cursor://taughtful.codebridge-opener/open?url=...) the CLI can fire with a
   plain `open` command. The handler resolves whichever built-in browser
   command this IDE build actually has (Cursor's own browser first, VS Code's
   Simple Browser as fallback) at runtime, since the command ids differ across
   forks and versions. Falls back to the external browser so a lesson is never
   lost. Diagnostics land in ~/.codebridge-ide.log. */

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG = path.join(os.homedir(), '.codebridge-ide.log');
function log(msg) {
  try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch { /* noop */ }
}

/* Only lesson/picker origins may be opened — the URI handler is reachable by
   any local process, so it must not be a generic "open anything" primitive. */
function allowed(url) {
  return /^https:\/\/(www\.)?taughtful\.ai\//.test(url)
    || /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url);
}

async function openInIde(url) {
  if (!allowed(url)) { log('refused non-allowlisted url: ' + url); return; }
  const cmds = await vscode.commands.getCommands(true);
  // Cursor's REAL browser (the Chromium one with working mic) is the
  // browserView/Browser Editor family — discovered from the command registry,
  // there is no documented API. Simple Browser (a webview iframe, no mic)
  // only as last in-IDE resort.
  const tries = [
    ['cursor.browserView.newTab', url],
    ['workbench.action.newBrowserTab', url],
    ['workbench.action.openBrowserEditor', url],
    ['simpleBrowser.api.open', vscode.Uri.parse(url)],
    ['simpleBrowser.show', url],
  ];
  for (const [cmd, arg] of tries) {
    if (!cmds.includes(cmd)) continue;
    try {
      const res = await vscode.commands.executeCommand(cmd, arg);
      log('opened via ' + cmd + ' → ' + JSON.stringify(res));
      // Some of these open the browser but ignore the url argument (arg
      // shape is undocumented) — steer the fresh tab explicitly if a
      // navigate command exists; harmless when the arg was honored.
      if (cmd !== 'simpleBrowser.api.open' && cmd !== 'simpleBrowser.show'
          && cmds.includes('cursor.browserView.navigate')) {
        try {
          await vscode.commands.executeCommand('cursor.browserView.navigate', url);
          log('navigate steered to ' + url);
        } catch (e) { log('navigate steer failed: ' + (e && e.message)); }
      }
      return;
    } catch (e) {
      log(cmd + ' failed: ' + (e && e.message));
    }
  }
  log('no in-IDE browser command worked, falling back to external');
  vscode.env.openExternal(vscode.Uri.parse(url));
}

exports.activate = (ctx) => {
  ctx.subscriptions.push(vscode.window.registerUriHandler({
    handleUri(uri) {
      const url = new URLSearchParams(uri.query).get('url');
      log('uri handled: ' + uri.path + ' url=' + url);
      if (url) openInIde(url);
    },
  }));
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codebridge.open', (u) => u && openInIde(String(u)))
  );
  log('activated');
};

exports.deactivate = () => {};
