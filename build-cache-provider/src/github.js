// A TS->JS port of:
// https://github.com/expo/examples/blob/master/with-github-remote-build-cache-provider/build-cache-provider/src/github.ts

const { parseProjectEnv } = require('@expo/env');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { create: createTar } = require('tar');
const path = require('path');
const process = require('node:process');
const { execFileSync } = require('node:child_process');
const archiver = require('archiver');

const { getTmpDirectory } = require('./helpers');

/**
 * @typedef {{
 *   token?: string;
 *   owner: string;
 *   repo: string;
 *   tagName: string;
 *   binaryPath: string;
 *   compressionFormat?: 'tar' | 'zip';
 *   replaceExisting?: boolean;
 *   targetCommitish?: string;
 * }} GithubProviderOptions
 */

/**
 * @param {GithubProviderOptions} arg
 */
async function createReleaseAndUploadAsset({
  token,
  owner,
  repo,
  tagName,
  binaryPath,
  compressionFormat = 'tar',
  replaceExisting = false,
  targetCommitish,
}) {
  const octokit = await createOctokit({ token });

  try {
    const commitSha =
      targetCommitish || (await getCurrentCommitShaAsync(octokit, owner, repo));

    if (replaceExisting) {
      await deleteReleaseByTagIfExists(octokit, { owner, repo, tag: tagName });
      await deleteTagIfExists(octokit, { owner, repo, tag: tagName });
    }

    // Original Expo example captures return value but doesn't do anything with
    // it.
    // https://github.com/expo/examples/blob/a836cc44dd088b2da8c637205484e2ab8a58c2d8/with-github-remote-build-cache-provider/build-cache-provider/src/github.ts#L30
    await ensureAnnotatedTag(octokit, {
      owner,
      repo,
      tag: tagName,
      message: tagName,
      object: commitSha,
      type: 'commit',
      tagger: {
        name: 'Release Bot',
        email: 'bot@expo.dev',
        date: new Date().toISOString(),
      },
    });

    const release = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tagName,
      name: tagName,
      target_commitish: commitSha,
      draft: false,
      prerelease: false,
    });

    await uploadReleaseAsset(octokit, {
      owner,
      repo,
      releaseId: release.data.id,
      binaryPath,
      compressionFormat,
    });

    return release.url;
  } catch (error) {
    throw new Error(
      `GitHub release failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
exports.createReleaseAndUploadAsset = createReleaseAndUploadAsset;

/**
 *
 * @param {object} obj
 * @param {string} [obj.token]
 * @returns
 */
async function createOctokit({ token }) {
  const { Octokit } = await import('@octokit/rest');
  const authToken = token ?? getGitHubAuthToken();

  if (!authToken) {
    throw new Error(
      'No GitHub auth token found. Set BUILD_CACHE_PROVIDER_TOKEN in .env.local for local releases, or rely on GITHUB_TOKEN in GitHub Actions.',
    );
  }

  return new Octokit({ auth: authToken });
}

/**
 * @returns {string | null}
 */
function getGitHubAuthToken() {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN;
  }

  if (process.env.BUILD_CACHE_PROVIDER_TOKEN) {
    return process.env.BUILD_CACHE_PROVIDER_TOKEN;
  }

  const env = parseProjectEnv(path.resolve(__dirname, '../..'), {
    mode: 'production',
  }).env;

  return env.BUILD_CACHE_PROVIDER_TOKEN ?? null;
}
exports.getGitHubAuthToken = getGitHubAuthToken;

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<string>}
 */
async function getCurrentCommitShaAsync(octokit, owner, repo) {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
    }).trim();
  } catch {
    return await getBranchShaWithFallback(octokit, owner, repo);
  }
}

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<string>}
 */
async function getBranchShaWithFallback(octokit, owner, repo) {
  const branchesToTry = ['main', 'master'];

  for (const branchName of branchesToTry) {
    try {
      const { data } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: branchName,
      });
      return data.commit.sha;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Branch not found')
      ) {
        if (branchName === 'master') throw new Error('No valid branch found');
        continue;
      }
      throw error;
    }
  }
  throw new Error('Branch fallback exhausted');
}

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {import("@octokit/plugin-rest-endpoint-methods").RestEndpointMethodTypes["git"]["createTag"]["parameters"]} params
 * @returns {Promise<string>}
 */
async function ensureAnnotatedTag(octokit, params) {
  const { owner, repo, tag } = params;
  const refName = `refs/tags/${tag}`;

  try {
    const { data: existingRef } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `tags/${tag}`,
    });
    // Return existing tag SHA
    return existingRef.object.sha;
  } catch (err) {
    // @ts-ignore
    if (err.status !== 404) {
      throw err;
    }
  }

  // Create the annotated tag object
  const { data: tagData } = await octokit.rest.git.createTag(params);

  // Create the tag reference pointing to the new tag object
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: refName,
    sha: tagData.sha,
  });

  return tagData.sha;
}

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.tag
 * @returns {Promise<void>}
 */
async function deleteReleaseByTagIfExists(octokit, { owner, repo, tag }) {
  const release = await getReleaseByTagOrNull(octokit, { owner, repo, tag });
  if (!release) {
    return;
  }

  await octokit.rest.repos.deleteRelease({
    owner,
    repo,
    release_id: release.id,
  });
}

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.tag
 * @returns {Promise<void>}
 */
async function deleteTagIfExists(octokit, { owner, repo, tag }) {
  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `tags/${tag}`,
    });
  } catch (error) {
    const status = error?.status;
    const message =
      error instanceof Error ? error.message : String(error ?? '');

    if (
      status !== 404 &&
      !(status === 422 && message.includes('Reference does not exist'))
    ) {
      throw error;
    }
  }
}

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.tag
 * @returns {Promise<import("@octokit/plugin-rest-endpoint-methods").RestEndpointMethodTypes["repos"]["getReleaseByTag"]["response"]["data"] | null>}
 */
async function getReleaseByTagOrNull(octokit, { owner, repo, tag }) {
  try {
    const release = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag,
    });
    return release.data;
  } catch (error) {
    // @ts-ignore
    if (error?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.releaseId
 * @param {string} params.binaryPath
 * @param {'tar' | 'zip'} [params.compressionFormat='tar'] - Compression format to use for directories
 */
async function uploadReleaseAsset(octokit, params) {
  let filePath = params.binaryPath;
  let name = path.basename(filePath);
  const compressionFormat = params.compressionFormat || 'tar';

  if ((await fs.stat(filePath)).isDirectory()) {
    await fs.mkdirp(await getTmpDirectory());
    const parentPath = path.dirname(filePath);

    if (compressionFormat === 'zip') {
      const zipPath = path.join(await getTmpDirectory(), `${uuidv4()}.zip`);
      await createZip(filePath, zipPath);
      filePath = zipPath;
      name = name + '.zip';
    } else {
      const tarPath = path.join(await getTmpDirectory(), `${uuidv4()}.tar.gz`);
      await createTar({ cwd: parentPath, file: tarPath, gzip: true }, [name]);
      filePath = tarPath;
      name = name + '.tar.gz';
    }
  }

  /** @type {string} Type workaround for binary data */
  // @ts-ignore
  const fileData = await fs.readFile(filePath);

  return octokit.rest.repos.uploadReleaseAsset({
    owner: params.owner,
    repo: params.repo,
    release_id: params.releaseId,
    name: name,
    data: fileData,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': fileData.length.toString(),
    },
  });
}

/**
 * Create a zip archive of a directory
 * @param {string} sourceDir - Directory to compress
 * @param {string} outputPath - Path for the output zip file
 * @returns {Promise<void>}
 */
async function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    output.on('close', () => resolve());
    output.on('error', err => reject(err));
    archive.on('error', err => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 *
 * @param {object} arg
 * @param {string} arg.token
 * @param {string} arg.owner
 * @param {string} arg.repo
 * @param {string} arg.tag
 */
async function getReleaseAssetsByTag({ token, owner, repo, tag }) {
  const octokit = await createOctokit({ token });
  const release = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  });
  return release.data.assets;
}
exports.getReleaseAssetsByTag = getReleaseAssetsByTag;

exports.createZip = createZip;
