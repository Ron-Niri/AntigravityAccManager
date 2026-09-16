const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function chromePaths(environment = process.env) {
  return [
    environment.PROGRAMFILES && path.join(environment.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    environment['PROGRAMFILES(X86)'] && path.join(environment['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
}

function profilesFromState(state) {
  return Object.entries(state.profile?.info_cache || {}).map(([directory, profile]) => ({
    directory,
    name: profile.name || directory,
    email: profile.user_name || ''
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function readProfiles(localStatePath) {
  return profilesFromState(JSON.parse(fs.readFileSync(localStatePath, 'utf8')));
}

function profileAccounts(userDataPath, profile, readFile = fs.readFileSync) {
  const userData = path.resolve(userDataPath);
  const profilePath = path.resolve(userData, profile.directory);
  if (path.dirname(profilePath) !== userData) return [];
  let stored = [];
  try {
    const preferences = JSON.parse(readFile(path.join(profilePath, 'Preferences'), 'utf8'));
    stored = Array.isArray(preferences.account_info) ? preferences.account_info.map(account => account?.email) : [];
  } catch { /* A closed, missing, or older profile can still use its primary hint. */ }
  const emails = [...new Set([...stored, profile.email].filter(email => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  return emails.map(email => ({ directory: profile.directory, profileName: profile.name, email }));
}

function uniqueAccounts(accounts) {
  const seen = new Set();
  return accounts.filter(account => {
    const key = account.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function discover(environment = process.env) {
  const executable = chromePaths(environment).find(candidate => fs.existsSync(candidate));
  const localState = environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Local State');
  if (!executable || !localState || !fs.existsSync(localState)) return { executable, profiles: [], accounts: [] };
  const profiles = readProfiles(localState);
  const userData = path.dirname(localState);
  return { executable, profiles, accounts: uniqueAccounts(profiles.flatMap(profile => profileAccounts(userData, profile))) };
}

function openProfile(executable, directory, url, launch = spawn) {
  const child = launch(executable, [`--profile-directory=${directory}`, `--app=${url}`], {
    detached: true, stdio: 'ignore', windowsHide: false
  });
  child.unref();
  return true;
}

function closeWindow(title, launch = spawn) {
  if (!/^Antigravity OAuth [a-f0-9]{16}$/.test(title)) return false;
  const escaped = title.replaceAll("'", "''");
  const script = `$code=@'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AgmWindowCloser {
  public delegate bool Callback(IntPtr handle, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
  public static bool Close(string title) { bool found = false; EnumWindows((handle, data) => { var text = new StringBuilder(256); GetWindowText(handle, text, text.Capacity); if (text.ToString().Contains(title)) { PostMessage(handle, 0x0010, IntPtr.Zero, IntPtr.Zero); found = true; } return true; }, IntPtr.Zero); return found; }
}
'@; Add-Type -TypeDefinition $code; for($i=0;$i -lt 30;$i++){ if([AgmWindowCloser]::Close('${escaped}')){ exit 0 }; Start-Sleep -Milliseconds 100 }; exit 1`;
  const child = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: false, stdio: 'ignore', windowsHide: true
  });
  return new Promise(resolve => {
    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
  });
}

module.exports = { chromePaths, profilesFromState, readProfiles, profileAccounts, uniqueAccounts, discover, openProfile, closeWindow };
