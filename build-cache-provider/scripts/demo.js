// This script file is for trying out the build cache provider in isolation,
// without having to run a full `npx expo run:ios` command.
//
// Run it as follows:
// node ./build-cache-provider/scripts/demo.js

const expoSpawnAsync = require('@expo/spawn-async');
const ExpoFingerprintUtils = require('@expo/fingerprint/build/sourcer/Utils');
const ExpoResolver = require('@expo/fingerprint/build/ExpoResolver');
const chalk = require('chalk');
const debug = require('debug')('build-cache-provider:demo');
const path = require('node:path');

const {
  default: providerPlugin,
  uploadGitHubRemoteBuildCache,
} = require('../src/index');

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
      buildPath: '',
    },
    { owner: 'shirakaba', repo: 'paranovel-two' },
  );
}

/**
 * Returns a fingerprint hash, e.g. "8599e6998f3a3682050d5d256b1afe6b419b937b".
 *
 * https://github.com/expo/expo/blob/0866d35160af6490e04699313822cb76430d323b/packages/%40expo/cli/src/utils/build-cache-providers/index.ts#L147
 * node_modules/@expo/cli/build/src/utils/build-cache-providers/index.js
 *
 * @param {object} arg
 * @param {string} arg.projectRoot
 * @param {"android" | "ios" | "macos"} arg.platform
 * @param {import("@expo/config").BuildCacheProvider} arg.provider
 * @param {import("@expo/config").RunOptions} arg.runOptions
 * @returns {Promise<string | null>}
 */
async function calculateFingerprintHashAsync({
  projectRoot,
  runOptions,
  platform,
  provider,
}) {
  if (provider.plugin.calculateFingerprintHash) {
    return await provider.plugin.calculateFingerprintHash(
      {
        projectRoot,
        // @ts-expect-error Expo is only expecting "android" | "ios"
        platform,
        runOptions,
      },
      provider.options,
    );
  }
  const Fingerprint = importFingerprintForDev(projectRoot);
  if (!Fingerprint) {
    console.warn(
      '[build-cache-provider] @expo/fingerprint is not installed in the project, unable to calculate fingerprint',
    );
    return null;
  }
  const fingerprint = await Fingerprint.createFingerprintAsync(
    projectRoot,
    optionsForMacos(projectRoot, {}),
  );
  return fingerprint.hash;
}

/**
 * @param {string} projectRoot
 * @param {import("@expo/fingerprint").Options} options
 * @returns {Promise<import("@expo/fingerprint").Options>}
 */
async function optionsForMacos(projectRoot, options) {
  /** @type {import("@expo/fingerprint").Options} */
  const resolvedOptions = {
    // @ts-expect-error Expo is only expecting "android" | "ios"
    platforms: ['macos'],
    // Based on some of DEFAULT_IGNORE_PATHS
    // node_modules/.bun/@expo+fingerprint@0.15.2/node_modules/@expo/fingerprint/build/Options.js
    ignorePaths: [
      '**/macos/Pods/**/*',
      '**/macos/build/**/*',
      '**/macos/.xcode.env.local',
      '**/macos/**/project.xcworkspace',
      '**/macos/*.xcworkspace/xcuserdata/**/*',
    ],

    ...options,
  };

  const [extraSources] = await Promise.all([
    getBareMacosSourcesAsync(projectRoot, {
      platforms:
        // @ts-expect-error Expo is only expecting "android" | "ios"
        resolvedOptions.platforms?.filter(platform => platform === 'macos') ??
        [],
    }),
  ]);

  return {
    ...resolvedOptions,
    extraSources,
  };
}

/**
 *
 * @param {string} projectRoot
 * @param {Pick<import("@expo/fingerprint").NormalizedOptions, "platforms">} options
 *
 * @return {Promise<Array<import("@expo/fingerprint").HashSource>>}
 */
async function getBareMacosSourcesAsync(projectRoot, options) {
  // @ts-expect-error Expo is only expecting "android" | "ios"
  if (options.platforms.includes('macos')) {
    const result = await ExpoFingerprintUtils.getFileBasedHashSourceAsync(
      projectRoot,
      'ios',
      'bareNativeDir',
    );

    if (result != null) {
      debug(`Adding bare native dir - ${chalk.dim('macos')}`);
      return [result];
    }
  }
  return [];
}

/**
 * https://github.com/expo/expo/blob/0866d35160af6490e04699313822cb76430d323b/packages/%40expo/cli/src/utils/build-cache-providers/index.ts#L175
 * @param {string} projectRoot
 */
function importFingerprintForDev(projectRoot) {
  try {
    return require(require.resolve('@expo/fingerprint', {
      paths: [projectRoot],
    }));
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND'
    ) {
      return null;
    }
    throw error;
  }
}
