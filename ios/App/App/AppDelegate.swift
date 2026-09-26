import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // The game now has a continuous music bed, so declare the politest
        // session we can: `.ambient` is secondary audio that obeys the physical
        // silent switch, and `.mixWithOthers` lets the player's Spotify or
        // podcast keep playing underneath.
        //
        // HONEST CAVEAT — this may not actually govern our sound. All game audio
        // is Web Audio inside a WKWebView, and WKWebView runs its own audio
        // session in a separate process; WebKit bug 167788 (open since 2017,
        // still confirmed by reporters in 2025) says the host app's category is
        // ignored there. So treat this as "correct and free", not as the thing
        // that guarantees Spotify survives. That has to be checked on a real
        // device: start Spotify, launch the app, see whether it keeps playing.
        // If it does not, the fix is native — implement GADAudioVideoManagerDelegate
        // and take over the session — not a TypeScript change. See docs/AUDIO.md.
        //
        // Do NOT "upgrade" this to .playback: that category is for apps whose
        // audio IS the point (music players, video), it interrupts other apps,
        // and it ignores the mute switch.
        try? AVAudioSession.sharedInstance().setCategory(
            .ambient,
            mode: .default,
            options: [.mixWithOthers]
        )
        return true
    }

    // UIScene lifecycle (Capacitor 8.5). iOS 27 refuses to launch an app built
    // with its SDK that has no scene manifest, and Xcode 27 is the only toolchain
    // on the release machine, so this is not optional. The window and the bridge
    // view controller now live in SceneDelegate.swift. Once Info.plist carries
    // UIApplicationSceneManifest, iOS stops calling the app-level lifecycle and
    // URL methods (applicationDidBecomeActive, application(_:open:options:),
    // application(_:continue:restorationHandler:)) — they were removed here, and
    // their Capacitor proxies moved to SceneDelegate. Nothing else lived in them.
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

}
