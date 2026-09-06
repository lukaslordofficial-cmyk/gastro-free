/**
 * Expo app config. Reads app.json and applies profile-specific native build tweaks.
 *
 * Fat APKs (preview / preview-apk / development) ship all ABIs in one file — ~90+ MB of
 * .so libs. Restrict those profiles to arm64-v8a (phones ~2017+). Production stays AAB
 * with all ABIs so Play Store can split per device.
 *
 * Ważne: tylko JEDEN wpis expo-build-properties — drugi plugin z pustym `android: {}`
 * potrafi nadpisać targetSdk (Play odrzucał build z API 33).
 */
const appJson = require('./app.json');

const profile = process.env.EAS_BUILD_PROFILE || '';
const fatApkProfiles = new Set(['preview-apk', 'preview', 'development']);
const arm64OnlyApk = fatApkProfiles.has(profile);

const plugins = (appJson.expo.plugins || []).map((p) => {
  const name = Array.isArray(p) ? p[0] : p;
  if (name !== 'expo-build-properties') return p;
  const prev = Array.isArray(p) && p[1] && typeof p[1] === 'object' ? p[1] : {};
  const prevAndroid =
    prev.android && typeof prev.android === 'object' ? prev.android : {};
  return [
    'expo-build-properties',
    {
      ...prev,
      android: {
        ...prevAndroid,
        usesCleartextTraffic: false,
        targetSdkVersion: 35,
        compileSdkVersion: 35,
        minSdkVersion: Math.max(24, Number(prevAndroid.minSdkVersion) || 24),
        ...(arm64OnlyApk ? { buildArchs: ['arm64-v8a'] } : {}),
      },
    },
  ];
});

const hasBuildProps = plugins.some(
  (p) => (Array.isArray(p) ? p[0] : p) === 'expo-build-properties',
);
if (!hasBuildProps) {
  plugins.push([
    'expo-build-properties',
    {
      android: {
        usesCleartextTraffic: false,
        targetSdkVersion: 35,
        compileSdkVersion: 35,
        minSdkVersion: 24,
        ...(arm64OnlyApk ? { buildArchs: ['arm64-v8a'] } : {}),
      },
    },
  ]);
}

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
