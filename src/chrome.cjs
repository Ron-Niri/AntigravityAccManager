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

function discover(environment = process.env) {
  const executable = chromePaths(environment).find(candidate => fs.existsSync(candidate));
  const localState = environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Local State');
  if (!executable || !localState || !fs.existsSync(localState)) return { executable, profiles: [] };
  return { executable, profiles: readProfiles(localState) };
}

function openProfile(executable, directory, url) {
  const child = spawn(executable, [`--profile-directory=${directory}`, '--new-window', url], {
    detached: true, stdio: 'ignore', windowsHide: false
  });
  child.unref();
  return true;
}

module.exports = { chromePaths, profilesFromState, readProfiles, discover, openProfile };
