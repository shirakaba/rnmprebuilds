const expoSpawnAsync = require('@expo/spawn-async');
const ExpoFingerprintUtils = require('@expo/fingerprint/build/sourcer/Utils');
const ExpoResolver = require('@expo/fingerprint/build/ExpoResolver');
const ExpoPath = require('@expo/fingerprint/build/utils/Path');
const ExpoFingerprintOptions = require('@expo/fingerprint/build/Options');
const ExpoPackages = require('@expo/fingerprint/build/sourcer/Packages');
const SourceSkips = require('@expo/fingerprint/build/sourcer/SourceSkips');
const resolveFrom = require('resolve-from');
const chalk = require('chalk');
const debug = require('debug')('build-cache-provider:demo');
const path = require('node:path');
const assert = require('node:assert');
const process = require('node:process');

/**
 * @param {string} projectRoot
 * @param {import("@expo/fingerprint").Options} options
 * @returns {Promise<import("@expo/fingerprint").Options>}
 */
async function getExtraOptionsForMacos(projectRoot, options) {
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

    // Just trying out.
    useRNCoreAutolinkingFromExpo: true,

    ...options,
  };

  /** @type {Pick<import("@expo/fingerprint").NormalizedOptions, "platforms" | "sourceSkips">} */
  const sourcerOptions = {
    platforms:
      // @ts-expect-error Expo is only expecting "android" | "ios"
      resolvedOptions.platforms?.filter(platform => platform === 'macos') ?? [],
    sourceSkips:
      resolvedOptions.sourceSkips ??
      ExpoFingerprintOptions.DEFAULT_SOURCE_SKIPS,
  };

  const [
    expoAutolinkingMacosSources,
    packageJsonScriptSourcesAsync,
    bareMacosSources,
    coreAutolinkingSourcesFromExpoMacos,
    defaultPackageSourcesAsync,
  ] = await Promise.all([
    getExpoAutolinkingMacosSourcesAsync(projectRoot, sourcerOptions),
    getPackageJsonScriptSourcesAsync(projectRoot, sourcerOptions),
    getBareMacosSourcesAsync(projectRoot, sourcerOptions),
    getCoreAutolinkingSourcesFromExpoMacos(
      projectRoot,
      sourcerOptions,
      resolvedOptions.useRNCoreAutolinkingFromExpo,
    ),
    getDefaultPackageSourcesAsync(projectRoot),
  ]);

  return {
    ...resolvedOptions,
    extraSources: [
      ...expoAutolinkingMacosSources,
      ...packageJsonScriptSourcesAsync,
      ...bareMacosSources,
      ...coreAutolinkingSourcesFromExpoMacos,
      ...defaultPackageSourcesAsync,
    ],
  };
}
exports.getExtraOptionsForMacos = getExtraOptionsForMacos;

/**
 *
 * @param {string} projectRoot
 * @param {Pick<import("@expo/fingerprint").NormalizedOptions, "platforms">} options
 *
 * @returns {Promise<Array<import("@expo/fingerprint").HashSource>>}
 */
async function getExpoAutolinkingMacosSourcesAsync(projectRoot, options) {
  // @ts-expect-error Expo is only expecting "android" | "ios"
  if (!options.platforms.includes('macos')) {
    return [];
  }

  try {
    const reasons = ['expoAutolinkingMacos'];
    const results = [];
    const { stdout } = await expoSpawnAsync(
      'node',
      [
        ExpoResolver.resolveExpoAutolinkingCliPath(projectRoot),
        'resolve',
        '-p',
        'apple',
        '--json',
      ],
      { cwd: projectRoot },
    );
    const config = JSON.parse(stdout);
    for (const module of config.modules) {
      for (const pod of module.pods) {
        const filePath = ExpoPath.toPosixPath(
          path.relative(projectRoot, pod.podspecDir),
        );
        pod.podspecDir = filePath; // use relative path for the dir
        debug(
          `Adding expo-modules-autolinking macos dir - ${chalk.dim(filePath)}`,
        );
        results.push({ type: 'dir', filePath, reasons });
      }
    }
    results.push({
      type: 'contents',
      id: 'expoAutolinkingConfig:macos',
      contents: JSON.stringify(config),
      reasons,
    });
    // @ts-ignore
    return results;
  } catch {
    return [];
  }
}

/**
 *
 * @param {string} projectRoot
 * @param {Pick<import("@expo/fingerprint").NormalizedOptions, "sourceSkips">} options
 * @returns {Promise<Array<import("@expo/fingerprint").HashSource>>}
 */
async function getPackageJsonScriptSourcesAsync(projectRoot, options) {
  if (options.sourceSkips & SourceSkips.SourceSkips.PackageJsonScriptsAll) {
    return [];
  }
  /** @type {{ scripts?: Record<string, string>}} */
  let packageJson;
  try {
    packageJson = require(resolveFrom(
      path.resolve(projectRoot),
      './package.json',
    ));
  } catch (e) {
    debug(
      `Unable to read package.json from ${path.resolve(
        projectRoot,
      )}/package.json: ` + e,
    );
    return [];
  }
  /** @type {Array<import("@expo/fingerprint").HashSource>} */
  const results = [];
  if (packageJson.scripts) {
    debug(`Adding package.json contents - ${chalk.dim('scripts')}`);
    const id = 'packageJson:scripts';
    results.push({
      type: 'contents',
      id,
      contents: normalizePackageJsonScriptSources(packageJson.scripts, options),
      reasons: [id],
    });
  }
  return results;
}

/**
 *
 * @param {Record<string, string>} scripts
 * @param {Pick<import("@expo/fingerprint").NormalizedOptions, "sourceSkips">} options
 * @returns
 */
function normalizePackageJsonScriptSources(scripts, options) {
  if (
    options.sourceSkips &
    SourceSkips.SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun
  ) {
    // Replicate the behavior of `expo prebuild`
    if (
      !scripts.android?.includes('run') ||
      scripts.android === 'expo run:android'
    ) {
      delete scripts.android;
    }
    if (!scripts.ios?.includes('run') || scripts.ios === 'expo run:ios') {
      delete scripts.ios;
    }
    if (!scripts.macos?.includes('run') || scripts.macos === 'expo run:macos') {
      delete scripts.macos;
    }
  }
  return JSON.stringify(scripts);
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
      'macos',
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
 *
 * @param {string} projectRoot
 * @param {Pick<import("@expo/fingerprint").NormalizedOptions, "platforms">} options
 * @param {boolean} [useRNCoreAutolinkingFromExpo]
 * @returns
 */
async function getCoreAutolinkingSourcesFromExpoMacos(
  projectRoot,
  options,
  useRNCoreAutolinkingFromExpo,
) {
  if (
    useRNCoreAutolinkingFromExpo === false ||
    // @ts-expect-error Expo is only expecting "android" | "ios"
    !options.platforms.includes('macos')
  ) {
    return [];
  }
  try {
    const { stdout } = await expoSpawnAsync(
      'node',
      [
        ExpoResolver.resolveExpoAutolinkingCliPath(projectRoot),
        'react-native-config',
        '--json',
        '--platform',
        'macos',
      ],
      { cwd: projectRoot },
    );
    const config = JSON.parse(stdout);
    const results = await parseCoreAutolinkingSourcesAsync({
      config,
      contentsId: 'rncoreAutolinkingConfig:macos',
      reasons: ['rncoreAutolinkingMacos'],
      platform: 'macos',
    });
    return results;
  } catch (e) {
    debug(
      chalk.red(
        `Error adding react-native core autolinking sources for macos.\n${e}`,
      ),
    );
    return [];
  }
}

/**
 *
 * @param {object} param0
 * @param {any} param0.config
 * @param {Array<string>} param0.reasons
 * @param {string} param0.contentsId
 * @param {string} [param0.platform]
 *
 * @returns {Promise<Array<import("@expo/fingerprint").HashSource>>}
 */
async function parseCoreAutolinkingSourcesAsync({
  config,
  reasons,
  contentsId,
  platform,
}) {
  const logTag = platform
    ? `react-native core autolinking dir for ${platform}`
    : 'react-native core autolinking dir';
  const results = [];
  const { root } = config;
  const autolinkingConfig = {};
  for (const [depName, depData] of Object.entries(config.dependencies)) {
    try {
      stripRncoreAutolinkingAbsolutePaths(depData, root);
      const filePath = ExpoPath.toPosixPath(depData.root);
      debug(`Adding ${logTag} - ${chalk.dim(filePath)}`);
      results.push({ type: 'dir', filePath, reasons });
      // @ts-ignore
      autolinkingConfig[depName] = depData;
    } catch (e) {
      debug(chalk.red(`Error adding ${logTag} - ${depName}.\n${e}`));
    }
  }
  results.push({
    type: 'contents',
    id: contentsId,
    contents: JSON.stringify(autolinkingConfig),
    reasons,
  });

  // @ts-ignore
  return results;
}

/**
 *
 * @param {any} dependency
 * @param {string} root
 */
function stripRncoreAutolinkingAbsolutePaths(dependency, root) {
  assert(dependency.root);
  const dependencyRoot = dependency.root;
  const cmakeDepRoot =
    process.platform === 'win32'
      ? dependencyRoot.replace(/\\/g, '/')
      : dependencyRoot;
  dependency.root = ExpoPath.toPosixPath(path.relative(root, dependencyRoot));
  for (const platformData of Object.values(dependency.platforms)) {
    for (const [key, value] of Object.entries(platformData ?? {})) {
      let newValue;
      if (
        process.platform === 'win32' &&
        ['cmakeListsPath', 'cxxModuleCMakeListsPath'].includes(key)
      ) {
        // CMake paths on Windows are serving in slashes,
        // we have to check startsWith with the same slashes.
        newValue = value?.startsWith?.(cmakeDepRoot)
          ? ExpoPath.toPosixPath(path.relative(root, value))
          : value;
      } else {
        newValue = value?.startsWith?.(dependencyRoot)
          ? ExpoPath.toPosixPath(path.relative(root, value))
          : value;
      }
      platformData[key] = newValue;
    }
  }
}

/**
 * @param {string} projectRoot
 * @returns {Promise<Array<import("@expo/fingerprint").HashSource>>}
 */
async function getDefaultPackageSourcesAsync(projectRoot) {
  const results = await Promise.all(
    [
      {
        packageName: 'react-native-macos',
        packageJsonOnly: true,
      },
    ].map(params => ExpoPackages.getPackageSourceAsync(projectRoot, params)),
  );

  // @ts-ignore
  return results.filter(Boolean);
}
