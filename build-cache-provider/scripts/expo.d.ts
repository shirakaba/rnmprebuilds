declare module '@expo/cli/build/src/run/ios/XcodeBuild' {
  export function buildAsync(
    props: import('@expo/cli/build/src/run/ios/XcodeBuild.types').BuildProps,
  ): Promise<string>;
  export function getAppBinaryPath(buildOutput: string): Promise<string>;
}

declare module '@expo/cli/build/src/run/ios/XcodeBuild.types' {
  export type XcodeConfiguration = 'Debug' | 'Release';

  export type Options = {
    /** iOS device to target. */
    device?: string | boolean;
    /** Dev server port to use, ignored if `bundler` is `false`. */
    port?: number;
    /** Xcode scheme to build. */
    scheme?: string | boolean;
    /** Xcode configuration to build. Default `Debug` */
    configuration?: XcodeConfiguration;
    /** Should start the bundler dev server. */
    bundler?: boolean;
    /** Should install missing dependencies before building. */
    install?: boolean;
    /** Should use derived data for builds. */
    buildCache?: boolean;
    /** Path to an existing binary to install on the device. */
    binary?: string;

    /** Re-bundle JS and assets, then embed in existing app, and install again. */
    rebundle?: boolean;
  };

  export type ProjectInfo = {
    isWorkspace: boolean;
    name: string;
  };

  export type BuildProps = {
    /** Root to the iOS native project. */
    projectRoot: string;
    /** Is the target a simulator. */
    isSimulator: boolean;
    xcodeProject: ProjectInfo;
    device: {
      name: string;
      udid: string;
      osType: 'iOS' | 'tvOS' | 'watchOS' | 'macOS' | 'xrOS';
    };
    configuration: XcodeConfiguration;
    /** Disable the initial bundling from the native script. */
    shouldSkipInitialBundling: boolean;
    /** Should use derived data for builds. */
    buildCache: boolean;
    scheme: string;
    buildCacheProvider?: import('@expo/config').BuildCacheProvider;

    /** Options that were used to create the eager bundle in release builds. */
    eagerBundleOptions?: string;

    /** Port to start the dev server on. */
    port: number;
    /** Skip opening the bundler from the native script. */
    shouldStartBundler: boolean;
  };
}

declare module '@expo/cli/build/src/run/ios/options/resolveOptions' {
  export function resolveOptionsAsync(
    projectRoot: string,
    options: import('@expo/cli/build/src/run/ios/XcodeBuild.types').Options,
  ): Promise<import('@expo/cli/build/src/run/ios/XcodeBuild.types').BuildProps>;
}

declare module '@expo/cli/build/src/run/ios/options/resolveNativeScheme' {
  export function resolveNativeSchemePropsAsync(
    projectRoot: string,
    options: import('@expo/cli/build/src/run/ios/XcodeBuild.types').Options,
    xcodeProject: import('@expo/cli/build/src/run/ios/XcodeBuild.types').ProjectInfo,
  ): Promise<{
    name: string;
    osType?: string;
  }>;
}
