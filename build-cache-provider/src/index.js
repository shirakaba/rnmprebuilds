// A TS->JS port of:
// https://github.com/expo/examples/blob/master/with-github-remote-build-cache-provider/build-cache-provider/src/index.ts

const { parseProjectEnv } = require('@expo/env');
const process = require('node:process');
const path = require('node:path');
const fs = require('node:fs');

const {
  isDevClientBuild,
  getBuildRunCacheDirectoryPath,
} = require('./helpers');
const {
  getReleaseAssetsByTag,
  createReleaseAndUploadAsset,
} = require('./github');
const { downloadAndMaybeExtractAppAsync } = require('./download');

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

/**
 *
 * @param {import("@expo/config").ResolveBuildCacheProps} resolveBuildCacheProps
 * @param {object} options options passed in from app.json.
 * @param {string} options.owner
 * @param {string} options.repo
 *
 * @returns {Promise<string | null>}
 */
async function resolveGitHubRemoteBuildCache(
  { projectRoot, platform, fingerprintHash, runOptions },
  { owner, repo },
) {
  // Gives a value of, for example (on macOS):
  //   '/var/folders/0m/nf10bfxx6rgft8tn29fznymc0000gn/T/github-build-cache-provider-nodejs/build-run-cache/fingerprint.a7672e8d257130e45120c54592207c049c5feb4a.app'
  const cachedAppPath = await getCachedAppPath({
    fingerprintHash,
    platform,
    projectRoot,
    runOptions,
  });
  if (fs.existsSync(cachedAppPath)) {
    console.log('[build-cache-provider] Cached build found, skipping download');
    return cachedAppPath;
  }
  if (!BUILD_CACHE_PROVIDER_TOKEN) {
    console.log(
      '[build-cache-provider] No BUILD_CACHE_PROVIDER_TOKEN env var found in project env files; build-cache-provider skipping resolveGitHubRemoteBuildCache.',
    );
    return null;
  }
  console.log(
    `[build-cache-provider] Searching builds with matching fingerprint on Github Releases`,
  );
  try {
    const assets = await getReleaseAssetsByTag({
      token: BUILD_CACHE_PROVIDER_TOKEN,
      owner,
      repo,
      tag: getTagName({
        fingerprintHash,
        projectRoot,
        runOptions,
      }),
    });

    const buildDownloadURL = assets[0].browser_download_url;
    return await downloadAndMaybeExtractAppAsync(
      buildDownloadURL,
      platform,
      cachedAppPath,
    );
  } catch (error) {
    console.log(
      '[build-cache-provider] No cached builds available for this fingerprint',
    );
  }
  return null;
}
exports.resolveGitHubRemoteBuildCache = resolveGitHubRemoteBuildCache;

/**
 *
 * @param {import("@expo/config").UploadBuildCacheProps} uploadBuildCacheProps
 * @param {object} options options passed in from app.json.
 * @param {string} options.owner
 * @param {string} options.repo
 *
 * @returns {Promise<string | null>}
 */
async function uploadGitHubRemoteBuildCache(
  { projectRoot, fingerprintHash, runOptions, buildPath },
  { owner, repo },
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
      tagName: getTagName({
        fingerprintHash,
        projectRoot,
        runOptions,
      }),
      binaryPath: buildPath,
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
exports.uploadGitHubRemoteBuildCache = uploadGitHubRemoteBuildCache;

/**
 *
 * @param {object} arg
 * @param {string} arg.fingerprintHash
 * @param {string} arg.projectRoot
 * @param {import("@expo/config").RunOptions} arg.runOptions
 *
 * @returns {string}
 */
function getTagName({ fingerprintHash, projectRoot, runOptions }) {
  const isDevClient = isDevClientBuild({ projectRoot, runOptions });

  return `fingerprint.${fingerprintHash}${isDevClient ? '.dev-client' : ''}`;
}

/**
 *
 * @param {object} arg
 * @param {string} arg.fingerprintHash
 * @param {string} arg.projectRoot
 * @param {import("@expo/config").RunOptions} arg.runOptions
 * @param {"ios" | "macos" | "android"} arg.platform
 *
 * @returns {Promise<string>}
 */
async function getCachedAppPath({
  fingerprintHash,
  platform,
  projectRoot,
  runOptions,
}) {
  // On macOS, this resolves as:
  //   path.join(os.tmpdir(), 'github-build-cache-provider', 'build-run-cache')
  // … thus:
  //   '/var/folders/0m/nf10bfxx6rgft8tn29fznymc0000gn/T/github-build-cache-provider-nodejs/build-run-cache'
  const buildRunCacheDirectoryPath = await getBuildRunCacheDirectoryPath();

  // This then returns:
  //   '/var/folders/0m/nf10bfxx6rgft8tn29fznymc0000gn/T/github-build-cache-provider-nodejs/build-run-cache/fingerprint.a7672e8d257130e45120c54592207c049c5feb4a.app'
  return path.join(
    buildRunCacheDirectoryPath,
    `${getTagName({
      fingerprintHash,
      projectRoot,
      runOptions,
    })}.${platform === 'ios' || platform === 'macos' ? 'app' : 'apk'}`,
  );
}

/**
 * @type {import("@expo/config").BuildCacheProviderPlugin}
 */
const providerPlugin = {
  resolveBuildCache: resolveGitHubRemoteBuildCache,
  // This is called upon `expo run ios` and `expo run android`:
  // node_modules/@expo/cli/build/src/run/ios/runIosAsync.js
  uploadBuildCache: uploadGitHubRemoteBuildCache,
};
exports.default = providerPlugin;
