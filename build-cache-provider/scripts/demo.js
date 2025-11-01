// This script file is for trying out the build cache provider in isolation,
// without having to run a full `npx expo run:ios` command.
//
// Run it as follows:
// node ./build-cache-provider/scripts/demo.js

const { parseProjectEnv } = require('@expo/env');
const { exec } = require('node:child_process');
const { argv, exit } = require('node:process');
const { mkdir, cp, writeFile, readFile, rm } = require('node:fs/promises');
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
const { createReleaseAndUploadAsset } = require('../src/github');
const repoPackageJson = require('../../package.json');

const { BUILD_CACHE_PROVIDER_TOKEN } = parseProjectEnv(
  path.resolve(__dirname, '../..'),
  {
    // This determines whether to load `.env.${mode}` and `.env.${mode}.local`.
    // Possible values are 'development', 'production', and 'test'.
    //
    // TODO: Customise for debug vs. release builds, as done in:
    // node_modules/@expo/cli/build/src/run/ios/runIosAsync.js
    mode: 'production',
  },
).env;

main()
  .then(() => {
    console.log('[demo] success');
  })
  .catch(error => {
    console.error('[demo] failure', error);
  });

async function main() {
  const {
    cache: enableBuildCacheProvider,
    publish,
    config,
    help,
  } = parseArgs({
    args: argv.slice(2),
    options: {
      config: {
        type: 'string',
        default: 'Debug',
      },
      cache: {
        type: 'boolean',
        default: true,
      },
      publish: {
        type: 'boolean',
        default: false,
      },
      help: {
        short: 'h',
        type: 'boolean',
        default: false,
      },
    },
    allowNegative: true,
  }).values;

  if (help) {
    console.log(
      `
A 1:1 imitation of of \`expo run ios\` for React Native macOS, except it's only
concerned with building the app, not running it. Made purely for demoing React
Native support for build-cache-provider.

Usage: node demo.js
       node demo.js [options]
       node demo.js [-h | --help]

  --config        The build configuration. Accepted values are "Debug" and
                  "Release".
                  Default: "Debug".

  --cache         Enable the build cache provider.

                  If enabled:
                  - Generate a fingerprint of the current source.
                  - Check for locally cached builds of the same fingerprint.
                    - On cache hit, reuse the locally cached build.
                    - On cache miss, check the remote.
                      - On cache hit, reuse the remote build.
                      - On cache miss, build afresh. Store that fresh build into
                        local cache and upload it to the build cache provider.

                  If disabled, we build afresh every time.

                  Disable by passing --no-cache.
                  Default: true.

  --no-cache      Disable the build cache provider. See the --cache flag.

  --publish       As well as publishing a release under the fingerprint, publish
                  an (Electron Forge compatible) release under the tag for the
                  currently-installed version of react-native-macos. Requires
                  --cache to be enabled as well.
                  Default: false.

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

  if (publish && !enableBuildCacheProvider) {
    console.log(
      'Got --publish flag without --cache flag. To use --publish, please enable both.',
    );
    exit(1);
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

  if (!runOptions.binary && enableBuildCacheProvider) {
    const localPath = fingerprintHash
      ? await resolveGitHubRemoteBuildCache(
          {
            projectRoot,
            // @ts-expect-error Expo is only expecting "android" | "ios"
            platform,
            fingerprintHash,
            runOptions,
          },
          ownerAndRepo,
        )
      : null;
    if (localPath) {
      runOptions.binary = localPath; // '/var/folders/0m/nf10bfxx6rgft8tn29fznymc0000gn/T/github-build-cache-provider-nodejs/build-run-cache/fingerprint.2ef37bd3fff12d044bfe0077578bf391731325f3.app'
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
      //
      // If you set `isSimulator: true`, it skips the prompt and, based on the
      // below, seems to ad-hoc sign it.
      //
      // Codesign verification (verbose=4)
      // - Signature=adhoc
      // - TeamIdentifier=not set
      // - CodeDirectory v=20400 size=472 flags=0x2(adhoc) hashes=4+7 location=embedded
      // - Sealed Resources version=2 rules=13 files=13
      //
      // Codesign verification (verbose=2)
      // - valid on disk
      // - satisfies its Designated Requirement
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

    // Although named "getAppBinaryPath()", for Mac apps, it returns the
    // Contents/Resources subdirectory, for example:
    // '/Users/jamie/Library/Developer/Xcode/DerivedData/rnmprebuilds-cfktnscoesgdwsdwwnwsasezdfqm/Build/Products/Debug/rnmprebuilds.app/Contents/Resources'
    const bundleResourcesPath = await XcodeBuild.getAppBinaryPath(buildOutput);

    // The binaryPath refers to the .app, so we climb out of Contents/Resources.
    binaryPath = path.resolve(bundleResourcesPath, '../..');

    shouldUpdateBuildCache = enableBuildCacheProvider;
  }

  // TODO: Ensure port hasn't become busy during build
  // TODO: Start the Metro dev server
  // TODO: Kill any previous instance of the Mac app.
  // TODO: Launch the Mac app.

  if (!fingerprintHash) {
    return;
  }

  /** @type {import('@expo/config').UploadBuildCacheProps} */
  const uploadBuildCacheProps = {
    projectRoot: path.resolve(__dirname, '../..'),
    fingerprintHash,
    runOptions,
    // @ts-expect-error Expo is only expecting "android" | "ios"
    platform,
    buildPath: binaryPath,
  };

  if (shouldUpdateBuildCache) {
    await uploadGitHubRemoteBuildCache(uploadBuildCacheProps, ownerAndRepo);
  }

  // Create a release with the right folder structure and tag name to be
  // compatible with Electron Fiddle.
  if (publish) {
    const tagName = `v${repoPackageJson.dependencies['react-native-macos']}`;

    // Electron Fiddle forms a download URL based on the host architecture.
    // For now, we assume a blissful ARM-only world.
    // We need to match the following path to avoid forking
    // @electron/fiddle-core:
    //
    // 'v999.0.0/electron-v999.0.0-darwin-arm64.zip'
    const releaseDir = path.resolve(
      __dirname,
      `../releases/electron-${tagName}-darwin-arm64`,
    );
    await rm(releaseDir, { recursive: true });
    await mkdir(releaseDir);

    // Electron releases include the following files:
    // - Electron.app
    // - version
    // - LICENSE
    // - LICENSES.chromium.html
    // So we'll try to match most of these to improve consistency.
    const outFile = path.join(releaseDir, 'Electron.app');
    await cp(uploadBuildCacheProps.buildPath, outFile, { recursive: true });

    await writeFile(path.join(releaseDir, 'version'), tagName);
    const licence = await readFile(
      path.resolve(__dirname, '../../LICENSE.txt'),
    );
    await writeFile(path.join(releaseDir, 'LICENSE'), licence);

    await uploadGitHubRemoteBuildCacheForElectronFiddle(
      {
        ...uploadBuildCacheProps,
        buildPath: releaseDir,
      },
      {
        ...ownerAndRepo,
        tagName,
      },
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
 * A slight fork of resolveGitHubRemoteBuildCache() that allows us to alter the
 * the tag name and compression format to match Electron Fiddle's expectations.
 *
 * @param {import("@expo/config").UploadBuildCacheProps} uploadBuildCacheProps
 * @param {object} options options passed in from app.json.
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.tagName
 *
 * @returns {Promise<string | null>}
 */
async function uploadGitHubRemoteBuildCacheForElectronFiddle(
  { buildPath },
  { owner, repo, tagName },
) {
  if (!BUILD_CACHE_PROVIDER_TOKEN) {
    console.log(
      '[build-cache-provider] No BUILD_CACHE_PROVIDER_TOKEN env var found in project env files; build-cache-provider skipping uploadGitHubRemoteBuildCache.',
    );
    return null;
  }

  console.log(`[build-cache-provider] Uploading build to Github Releases`);
  try {
    const result = await createReleaseAndUploadAsset({
      token: BUILD_CACHE_PROVIDER_TOKEN,
      owner,
      repo,
      tagName,
      binaryPath: buildPath,
      compressionFormat: 'zip',
    });

    return result;
  } catch (error) {
    console.log('[build-cache-provider] error', error);
    console.error(
      '[build-cache-provider] Release failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    process.exit(1);
  }
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
