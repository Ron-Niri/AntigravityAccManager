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

function discover(environment = process.env) {
  const executable = chromePaths(environment).find(candidate => fs.existsSync(candidate));
  const localState = environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Local State');
  if (!executable || !localState || !fs.existsSync(localState)) return { executable, profiles: [], accounts: [] };
  const profiles = readProfiles(localState);
  const userData = path.dirname(localState);
  return { executable, profiles, accounts: profiles.flatMap(profile => profileAccounts(userData, profile)) };
}

function openProfile(executable, directory, url) {
  const child = spawn(executable, [`--profile-directory=${directory}`, '--new-window', url], {
    detached: true, stdio: 'ignore', windowsHide: false
  });
  child.unref();
  return true;
}

module.exports = { chromePaths, profilesFromState, readProfiles, profileAccounts, discover, openProfile };
