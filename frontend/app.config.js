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

const expo = {
  ...appJson.expo,
  // Explicit: Hermes is default on Expo 54 / RN 0.81; keep it on for smaller JS + smoother UI.
  jsEngine: 'hermes',
  plugins,
};

// Expo Go + niezalogowane CLI: owner/EAS projectId wymuszają login (niebieski ekran).
// Start lokalny: EXPO_GO_ANON=1 npx expo start --tunnel --port 8081
if (process.env.EXPO_GO_ANON === '1') {
  delete expo.owner;
  if (expo.extra) {
    const { eas, ...restExtra } = expo.extra;
    expo.extra = restExtra;
  }
}

module.exports = { expo };
