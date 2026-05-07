#!/usr/bin/env node
const notarizeEnabled = process.env.VAEXCORE_MAC_NOTARIZE === "1";
const signEnabled = process.env.VAEXCORE_MAC_SIGN === "1" || notarizeEnabled;
const requiredWhenSigning = ["VAEXCORE_MAC_SIGNING_IDENTITY"];
const requiredWhenNotarizing = [
  "VAEXCORE_APPLE_ID",
  "VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD",
  "VAEXCORE_APPLE_TEAM_ID",
];
const errors = [];

if (signEnabled) {
  for (const name of requiredWhenSigning) {
    if (!process.env[name]?.trim()) {
      errors.push(`${name} is required when VAEXCORE_MAC_SIGN=1 or VAEXCORE_MAC_NOTARIZE=1.`);
    }
  }
}

if (notarizeEnabled) {
  for (const name of requiredWhenNotarizing) {
    if (!process.env[name]?.trim()) {
      errors.push(`${name} is required when VAEXCORE_MAC_NOTARIZE=1.`);
    }
  }

  const appleId = process.env.VAEXCORE_APPLE_ID;
  if (appleId && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(appleId)) {
    errors.push("VAEXCORE_APPLE_ID must look like an Apple ID email address.");
  }

  const teamId = process.env.VAEXCORE_APPLE_TEAM_ID;
  if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) {
    errors.push("VAEXCORE_APPLE_TEAM_ID must be a 10-character Apple team id.");
  }

  const appPassword = process.env.VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD;
  if (appPassword && /\s/.test(appPassword)) {
    errors.push("VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD must not contain whitespace.");
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

if (!signEnabled && !notarizeEnabled) {
  console.log("macOS signing and notarization are disabled; set VAEXCORE_MAC_SIGN=1 or VAEXCORE_MAC_NOTARIZE=1 to require credentials.");
} else if (notarizeEnabled) {
  console.log("macOS release environment looks complete for signing and notarization.");
} else {
  console.log("macOS release environment looks complete for signing.");
}
