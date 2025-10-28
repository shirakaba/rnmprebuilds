// This script file is for trying out the build cache provider in isolation,
// without having to run a full `npx expo run:ios` command.
//
// Run it as follows:
// node ./build-cache-provider/scripts/demo.js

const { exec } = require('node:child_process');
const { argv } = require('node:process');
const { promisify, parseArgs } = require('node:util');
const execAsync = promisify(exec);

const path = require('node:path');
const XcodeBuild = require('@expo/cli/build/src/run/ios/XcodeBuild');
const {
  resolveNativeSchemePropsAsync,
} = require('@expo/cli/build/src/run/ios/options/resolveNativeScheme');

const {
  default: providerPlugin,
  resolveGitHubRemoteBuildCache,
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
  const { config, help } = parseArgs({
    args: argv.slice(2),
    options: {
      config: {
        type: 'string',
        default: false,
      },
      help: {
        short: 'h',
        type: 'boolean',
        default: false,
      },
    },
  }).values;

  if (help) {
    console.log(
      `
Usage: node demo.js
       node demo.js [options]
       node demo.js [-h | --help]

  --config        The build configuration. Accepted values are "Debug" and
                  "Release".
                  Default: "Debug".

  -h, --help      Show this help message and exit.

Examples:

# Debug build
$ node demo.js --config Debug

# Release build
$ node demo.js --config Release
`.trim(),
    );
    return;
  }

  if (config !== 'Release' && config !== 'Debug') {
    return;
  }

  /** @type {"ios" | "android" | "macos"} */
  const platform = 'macos';

  /** @type {import("@expo/config").RunOptions} */
  const runOptions = {
    // These first three options are the defaults from `npx expo run:ios`.
    buildCache: true,
    bundler: true,
    install: true,

    configuration: config,

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

  const ownerAndRepo = { owner: 'shirakaba', repo: 'rnmprebuilds' };

  const fingerprintHash = await calculateFingerprintHashAsync({
    projectRoot,
    runOptions,
    platform,
    provider: buildCacheProvider,
  });

  if (runOptions.binary) {
    const localPath = fingerprintHash
      ? await resolveGitHubRemoteBuildCache(
          {
            projectRoot,
            // @ts-expect-error Expo is only expecting "android" | "ios"
            platform,
            runOptions,
            provider: providerPlugin,
          },
          ownerAndRepo,
        )
      : null;
    if (localPath) {
      runOptions.binary = localPath;
    }
  }

  // TODO: implement options.rebundle

  /** @type {string} */
  let binaryPath;
  let shouldUpdateBuildCache = false;
  if (runOptions.binary) {
    // TODO: validate external binary
    binaryPath = runOptions.binary;
  } else {
    // TODO: implement eager bundling for Release mode

    // This would be the "correct" way to get the build props, but it relies on
    // app.json so won't work in bare React Native macOS apps.
    //   const buildProps = await resolveOptionsAsync(projectRoot, runOptions);

    const xcworkspacePath = path.resolve(
      projectRoot,
      'macos',
      'rnmprebuilds.xcworkspace',
    );

    /** @type {import('@expo/cli/build/src/run/ios/XcodeBuild.types').ProjectInfo} */
    const xcodeProject = { isWorkspace: true, name: xcworkspacePath };

    const { name } = await resolveNativeSchemePropsAsync(
      projectRoot,
      runOptions,
      xcodeProject,
    );
    // This is the scheme naming convention used by react-native-macos.
    const scheme = `${name}-macOS`;

    const deviceId = await getMyMacIdFromRunDestination({
      scheme,
      workspace: xcworkspacePath,
    });

    /** @type {import('@expo/cli/build/src/run/ios/XcodeBuild.types').BuildProps} */
    const buildProps = {
      buildCache: runOptions.buildCache ?? true,
      buildCacheProvider,
      configuration: runOptions.configuration ?? 'Debug',
      // If you set `isSimulator: false`, it prompts you to select your
      // "Development team for signing the app".
      isSimulator: true,
      device: {
        name: 'My Mac',
        udid: deviceId,
        osType: 'macOS',
      },
      port: 8081,
      projectRoot,
      scheme,
      shouldSkipInitialBundling: false,
      shouldStartBundler: true,
      xcodeProject,
    };

    // Spawn the `xcodebuild` process to create the app binary.
    const buildOutput = await XcodeBuild.buildAsync(buildProps);

    // '/Users/jamie/Library/Developer/Xcode/DerivedData/rnmprebuilds-cfktnscoesgdwsdwwnwsasezdfqm/Build/Products/Debug/rnmprebuilds.app/Contents/Resources'
    binaryPath = await XcodeBuild.getAppBinaryPath(buildOutput);

    shouldUpdateBuildCache = true;
  }

  // TODO: Ensure port hasn't become busy during build
  // TODO: Start the Metro dev server
  // TODO: Kill any previous instance of the Mac app.
  // TODO: Launch the Mac app.

  if (!fingerprintHash) {
    return;
  }

  if (shouldUpdateBuildCache) {
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
      ownerAndRepo,
    );
  }
}

/**
 * @param {object} args
 * @param {string} args.scheme
 * @param {string} args.workspace
 * @param {string} [args.cwd]
 */
async function getMyMacIdFromRunDestination({ scheme, workspace, cwd }) {
  /** @type {{ stdout: string; stderr: string; }} */
  let output;
  try {
    output = await execAsync(
      `xcodebuild -workspace "${workspace}" -scheme "${scheme}" -showdestinations`,
      { cwd },
    );
  } catch (cause) {
    throw new Error('Error getting run destinations', { cause });
  }

  for (const line of output.stdout.split('\n')) {
    const match = myMacPattern.exec(line);
    if (!match) {
      continue;
    }
    const [, id] = match;
    return id;
  }

  throw new Error(
    `Unable to find \"My Mac\" in destinations, given output:\n${output}`,
  );
}

/**
 * Matches within this output and captures the id:
 *
 * ```
 * Command line invocation:
 *     /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -workspace ./macos/rnmprebuilds.xcworkspace -scheme rnmprebuilds-macOS -showdestinations
 *
 *
 *
 *         Available destinations for the "rnmprebuilds-macOS" scheme:
 *                 { platform:macOS, arch:arm64, id:00006031-0018403C0268001C, name:My Mac }
 *                 { platform:macOS, name:Any Mac }
 * ```
 */
const myMacPattern = /{ platform:macOS, arch:.*, id:(.*), name:My Mac }/;
