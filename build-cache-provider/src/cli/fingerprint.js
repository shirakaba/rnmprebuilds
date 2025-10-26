const { getExtraOptionsForMacos } = require('../macos');

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

  const options = await getExtraOptionsForMacos(projectRoot, {});

  const fingerprint = await Fingerprint.createFingerprintAsync(
    projectRoot,
    options,
  );
  return fingerprint.hash;
}
exports.calculateFingerprintHashAsync = calculateFingerprintHashAsync;

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
