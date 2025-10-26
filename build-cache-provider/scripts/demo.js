// This script file is for trying out the build cache provider in isolation,
// without having to run a full `npx expo run:ios` command.
//
// Run it as follows:
// node ./build-cache-provider/scripts/demo.js

const path = require('node:path');
// const process = require('node:process');
const XcodeBuild = require('@expo/cli/build/src/run/ios/XcodeBuild');
// const {
//   resolveOptionsAsync,
// } = require('@expo/cli/build/src/run/ios/options/resolveOptions');
const {
  resolveNativeSchemePropsAsync,
} = require('@expo/cli/build/src/run/ios/options/resolveNativeScheme');

// node_modules/@expo/cli/build/src/run/ios/options/resolveOptions.js

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

  /** @type {import("@expo/config").RunOptions} */
  const runOptions = {
    // These first three options are the defaults from `npx expo run:ios`.
    buildCache: true,
    bundler: true,
    install: true,

    configuration: 'Debug',

    // The `binary` option is a path to an existing .app or .ipa to install,
    // allowing the CLI to skip the native build.
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

  const buildCacheProvider = { plugin: providerPlugin, options: {} };
  const fingerprintHash = await calculateFingerprintHashAsync({
    projectRoot,
    runOptions,
    platform,
    provider: buildCacheProvider,
  });
  if (!fingerprintHash) {
    throw new Error('Expected fingerprintHash to be non-null.');
  }

  // const buildOptions = await resolveOptionsAsync(projectRoot, runOptions);

  /** @type {import('@expo/cli/build/src/run/ios/XcodeBuild.types').ProjectInfo} */
  const xcodeProject = {
    isWorkspace: true,
    name: path.resolve(projectRoot, 'macos', 'rnmprebuilds.xcworkspace'),
  };

  const { name: scheme } = await resolveNativeSchemePropsAsync(
    projectRoot,
    runOptions,
    xcodeProject,
  );

  /** @type {import('@expo/cli/build/src/run/ios/XcodeBuild.types').BuildProps} */
  const buildProps = {
    buildCache: runOptions.buildCache ?? true,
    buildCacheProvider,
    configuration: runOptions.configuration ?? 'Debug',
    isSimulator: true,
    // { platform:macOS, arch:arm64, id:00006031-0018403C0268001C, name:My Mac }
    // { platform:macOS, name:Any Mac }
    // xcodebuild -workspace rnmprebuilds.xcworkspace -scheme rnmprebuilds-macOS -showdestinations
    device: {
      name: 'My Mac',
      udid: '00006031-0018403C0268001C',
      osType: 'macOS',
    },
    port: 8081,
    projectRoot,
    scheme: `${scheme}-macOS`,
    shouldSkipInitialBundling: false,
    shouldStartBundler: true,
    xcodeProject,
  };

  // Spawn the `xcodebuild` process to create the app binary.
  const buildOutput = await XcodeBuild.buildAsync(buildProps); // If `isSimulator: false`, this prompts "Development team for signing the app" and shows you your Apple Development certificates for various teams, and 3rd Party Mac Developer Installer.

  // '/Users/jamie/Library/Developer/Xcode/DerivedData/rnmprebuilds-cfktnscoesgdwsdwwnwsasezdfqm/Build/Products/Debug/rnmprebuilds.app/Contents/Resources'
  const binaryPath = await XcodeBuild.getAppBinaryPath(buildOutput);

  await uploadGitHubRemoteBuildCache(
    {
      projectRoot: path.resolve(__dirname, '../..'),
      fingerprintHash,
      runOptions,
      // @ts-expect-error Expo is only expecting "android" | "ios"
      platform,
      // Climb up out of Contents/Resources
      buildPath: path.resolve(binaryPath, '../..'),
    },
    { owner: 'shirakaba', repo: 'rnmprebuilds' },
  );
}
