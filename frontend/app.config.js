/**
 * Expo app config. Reads app.json and applies profile-specific native build tweaks.
 *
 * Fat APKs (preview / preview-apk / development) ship all ABIs in one file — ~90+ MB of
 * .so libs. Restrict those profiles to arm64-v8a (phones ~2017+). Production stays AAB
 * with all ABIs so Play Store can split per device.
 */
const appJson = require('./app.json');

const profile = process.env.EAS_BUILD_PROFILE || '';
const fatApkProfiles = new Set(['preview-apk', 'preview', 'development']);
const arm64OnlyApk = fatApkProfiles.has(profile);

const plugins = [...(appJson.expo.plugins || [])];

plugins.push([
  'expo-build-properties',
  {
    android: {
      // Sets reactNativeArchitectures in gradle.properties during prebuild.
      ...(arm64OnlyApk ? { buildArchs: ['arm64-v8a'] } : {}),
    },
  },
]);

module.exports = {
  expo: {
    ...appJson.expo,
    // Explicit: Hermes is default on Expo 54 / RN 0.81; keep it on for smaller JS + smoother UI.
    jsEngine: 'hermes',
    plugins,
  },
};
