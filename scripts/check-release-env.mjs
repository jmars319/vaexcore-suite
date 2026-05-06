#!/usr/bin/env node
const notarizeEnabled = process.env.VAEXCORE_MAC_NOTARIZE === "1";
const requiredWhenNotarizing = [
  "VAEXCORE_APPLE_ID",
  "VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD",
  "VAEXCORE_APPLE_TEAM_ID",
];

if (!notarizeEnabled) {
  console.log("macOS notarization is disabled; set VAEXCORE_MAC_NOTARIZE=1 to require Apple credentials.");
  process.exit(0);
}

const missing = requiredWhenNotarizing.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  for (const name of missing) {
    console.error(`error: ${name} is required when VAEXCORE_MAC_NOTARIZE=1.`);
  }
  process.exit(1);
}

console.log("macOS release environment looks complete for notarization.");
