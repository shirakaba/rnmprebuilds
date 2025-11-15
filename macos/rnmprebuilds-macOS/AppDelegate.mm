#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import <React/RCTReloadCommand.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"rnmprebuilds";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  
#if DEBUG
  // Here, we trigger a dev reload upon any changes saved to our magic file at:
  // ~/Library/Application Support/uk.co.birchlabs.rnfiddleclient/trigger-reload.txt
  // This is a hacky workaround to enable React Native Fiddle to trigger our app
  // to reconnect to Metro when needed (as we sometimes have to relaunch Metro
  // in a new CWD).
  //
  // Compared to "proper" methods of IPC, this requires neither TCC permissions
  // nor app focus, and should work even with App Sandbox and Hardened Runtime
  // enabled.
  TouchFile(ReloadTriggerFilePath());
  WatchFile(ReloadTriggerFilePath(), ^{
      RCTTriggerReloadCommandListeners(nil);
  });
#endif
  
  return [super applicationDidFinishLaunching:notification];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

#if DEBUG
static NSString *ReloadTriggerFilePath(void) {
  static NSString *reloadFilePath = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    NSString *appSupport = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
    NSString *bundleID = [[NSBundle mainBundle] bundleIdentifier];
    NSString *dir = [appSupport stringByAppendingPathComponent:bundleID];
    reloadFilePath = [dir stringByAppendingPathComponent:@"trigger-reload.txt"];
  });
  return reloadFilePath;
}

static NSError* TouchFile(NSString *filePath) {
  NSString *dir = [filePath stringByDeletingLastPathComponent];

  NSError *error = nil;
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:&error];
  if (error) {
    NSLog(@"Failed to create folder %@: %@", dir, error);
    return error;
  }

  [NSData.data writeToFile:filePath options:NSDataWritingAtomic error:&error];
  if (error) {
    NSLog(@"Failed to touch reload file: %@", error);
  }
  
  return error;
}

/**
 * Watch a file and run a block whenever it is written.
 * Stops watching if the file is deleted.
 */
static void WatchFile(NSString *filePath, void (^onWrite)(void)) {
    if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
        NSLog(@"File does not exist; skipping watcher.");
        return;
    }

    int fd = open([filePath fileSystemRepresentation], O_EVTONLY);
    if (fd < 0) {
        NSLog(@"Failed to open file for monitoring");
        return;
    }

    dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_VNODE,
                                                      fd,
                                                      DISPATCH_VNODE_WRITE | DISPATCH_VNODE_DELETE,
                                                      DISPATCH_TARGET_QUEUE_DEFAULT);

    dispatch_source_set_event_handler(source, ^{
        unsigned long flags = dispatch_source_get_data(source);

        if (flags & DISPATCH_VNODE_WRITE) {
            if (onWrite) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    onWrite();
                });
            }
        }

        if (flags & (DISPATCH_VNODE_DELETE | DISPATCH_VNODE_RENAME)) {
            NSLog(@"File deleted or renamed; stopping watcher.");
            dispatch_source_cancel(source);
            close(fd);
        }
    });

    dispatch_resume(source);
}
#endif

@end
