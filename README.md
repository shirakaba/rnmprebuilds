# React Native macOS prebuilds

## About

This repository contains prebuilt React Native macOS clients.

Just as [Electron Fiddle](https://github.com/electron/fiddle) launches ready-built Electron clients to run fiddles, [React Native Fiddle](https://github.com/shirakaba/react-native-fiddle) launches ready-build React Native macOS clients to run fiddles. This repo is the factory that produces those ready-built clients.

### What's in the client?

The clients are (for the most part) simply Hello World templates created by following the instructions in the React Native macOS [docs](https://microsoft.github.io/react-native-macos/docs/getting-started).

```sh
# Create a new React Native app via the React Native Community CLI template:
# https://github.com/react-native-community/template/tree/0.79-stable/template
npx @react-native-community/cli init rnmprebuilds --version 0.79

# Add React Native macOS on top:
# https://github.com/microsoft/react-native-macos/tree/0.79-stable/packages/helloworld
npx react-native-macos-init@latest --version 0.79.0
```

### Deviations from the templates

Minimal tweaks may be applied in case the templates or dependencies have any issues causing build failures (see the commit history for full details).

On top of that, we make some self-serving changes for the sake of [React Native Fiddle](https://github.com/shirakaba/react-native-fiddle), a mod of [Electron Fiddle](https://github.com/electron/fiddle).

#### The dev reload trigger file

The client listens for file changes at:

```
~/Library/Application Support/uk.co.birchlabs.rnfiddleclient/trigger-reload.txt
```

This crude IPC channel allows React Native Fiddle to trigger a dev reload of the client without prompting for TCC permissions even when the client lacks focus.

## Notes to self

Here's how I use this repo:

```sh
# Install npm dependencies
bun install

# Install CocoaPods
cd macos
pod install
cd ..

# Now generate a fine-grained GitHub Personal Access Token here:
# https://github.com/settings/personal-access-tokens
# - It should have access to the rnmprebuilds repo.
# - It should also have the following repository permissions:
#   - Read access to metadata.
#   - Read and Write access to code.
# Write it into .env.local in the format: `BUILD_CACHE_PROVIDER_TOKEN=github_pat_***`
touch .env.local

# To replace an existing v0.79.0 release, first delete the release from the
# GitHub Releases page: https://github.com/shirakaba/rnmprebuilds/releases
#
# Next, delete the v0.79.0 tag.
#
# Finally, run this command from the repo root:
node ./build-cache-provider/scripts/demo.js --publish
```

You may ask what exactly this script does. In `build-cache-provider/scripts/demo.js`, I've re-implemented most of the `expo run ios` command to support React Native macOS, right down to [Expo Fingerprint](https://expo.dev/blog/fingerprint-your-native-runtime) and the [build cache provider](https://expo.dev/blog/build-cache-providers-in-expo). This is normally offered through EAS, but I adapted Expo's official [example](https://github.com/expo/examples/tree/master/with-github-remote-build-cache-provider) of how to set up a self-hosted build cache provider, again adapting it to support React Native macOS.

Put it all together and I have a way to generate an ad hoc signed debug-configuration build of the client and push it straight to GitHub Releases under the appropriate version tag, e.g. `v0.79.0`. It also pushes a build tagged with the fingerprint (e.g. `fingerprint.78a05957a66a7b75e56f2f06981173bc448677a4`) while it's at it, mainly for the self-serving purpose that I can more easily pick up the CLI script as-is and use it in other projects as a sort of `expo run macos` command in future.
