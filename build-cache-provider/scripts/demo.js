// This script file is for trying out the build cache provider in isolation,
// without having to run a full `npx expo run:ios` command.
//
// Run it as follows:
// node ./build-cache-provider/scripts/demo.js

const path = require('node:path');

const {
  default: providerPlugin,
  uploadGitHubRemoteBuildCache,
} = require('../src/index');
const { calculateFingerprintHashAsync } = require('../src/cli/fingerprint');

main()
  .then(() => {
    console.log('[demo] success');
  })
  .catch(error => {
    console.error('[demo] failure', error);
  });

async function main() {
  /** @type {"ios" | "android" | "macos"} */
  const platform = 'macos';
  // The options I got by default from `npx expo run:ios`.
  /** @type {import("@expo/config").RunOptions} */
  const runOptions = {
    buildCache: true,
    bundler: true,
    install: true,
    // The `binary` option is a path to an existing .app or .ipa to install,
    // allowing the CLi to skip the native build.
    // - node_modules/@expo/cli/build/src/run/ios/index.js
    // - node_modules/@expo/cli/build/src/run/ios/runIosAsync.js
    //
    // If omitted, yet there's a build provider AND we're building for
    // simulator, Expo CLI will resolve from any existing build caches and set
    // options.binary to that if there's a cache hit.

    // The `unstable-rebundle` option is for re-bundling the app and assets for
    // a build to try different JS code in release builds.
  };
  const projectRoot = path.resolve(__dirname, '../..');

  const fingerprintHash = await calculateFingerprintHashAsync({
    projectRoot,
    runOptions,
    platform,
    provider: { plugin: providerPlugin, options: {} },
  });
  if (!fingerprintHash) {
    throw new Error('Expected fingerprintHash to be non-null.');
  }
  await uploadGitHubRemoteBuildCache(
    {
      projectRoot: path.resolve(__dirname, '../..'),
      fingerprintHash,
      runOptions,
      // @ts-expect-error Expo is only expecting "android" | "ios"
      platform,
      // This is determined by `binaryPath` in:
      // node_modules/@expo/cli/build/src/run/ios/runIosAsync.js
      buildPath: '',
    },
    { owner: 'shirakaba', repo: 'rnmprebuilds' },
  );
}
