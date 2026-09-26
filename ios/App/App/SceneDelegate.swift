import UIKit
import UserNotifications
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // A cold launch from a tapped reminder. Under UIScene, iOS hands that tap
        // to the scene here, and may do so before the local-notifications plugin
        // is the notification-center delegate, so the plugin can miss it. Keep the
        // route where the JS boot looks for it (src/services/session.ts); a copy
        // the plugin does deliver as well is dropped there as an echo.
        if let response = connectionOptions.notificationResponse {
            Self.savePendingRoute(from: response)
        }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    /// The plugin stores a notification's JS `extra` under `cap_extra` in
    /// userInfo; ours carry `{ route: 'daily' | 'map' | 'menu' }`. Written as Capacitor
    /// Preferences writes (UserDefaults, "CapacitorStorage." prefix), so the JS
    /// side reads it as the plain key `exactly67.pendingRoute`.
    private static func savePendingRoute(from response: UNNotificationResponse) {
        guard response.actionIdentifier != UNNotificationDismissActionIdentifier,
              let extra = response.notification.request.content.userInfo["cap_extra"] as? [String: Any],
              let route = extra["route"] as? String,
              route == "daily" || route == "map" || route == "menu" else { return }
        UserDefaults.standard.set(route, forKey: "CapacitorStorage.exactly67.pendingRoute")
    }
}
