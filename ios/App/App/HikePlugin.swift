import UIKit
import Capacitor
import CoreLocation
import UserNotifications

/// Registers the local plugin (it is not an npm package, so Capacitor does not find it by itself).
class RidgelineViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HikePlugin())
    }
}

/// "RidgelineHike": position updates for a hike the user started, and a notification per fork instruction.
/// Location goes to the web layer on this phone only; nothing is sent anywhere.
@objc(HikePlugin)
public class HikePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "HikePlugin"
    public let jsName = "RidgelineHike"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startHike", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopHike", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateNotification", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?
    private var pendingPermissionCall: CAPPluginCall?
    private var lastTitle = ""
    private let notificationId = "ridgeline.nav"

    private func locationManager() -> CLLocationManager {
        if let m = manager { return m }
        let m = CLLocationManager()
        m.delegate = self
        manager = m
        return m
    }

    private func locationState() -> String {
        switch locationManager().authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    private func withStates(_ done: @escaping ([String: Any]) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let n: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: n = "granted"
            case .denied: n = "denied"
            default: n = "prompt"
            }
            DispatchQueue.main.async { done(["location": self.locationState(), "notifications": n]) }
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.withStates { call.resolve($0) } }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.locationManager().authorizationStatus == .notDetermined {
                self.pendingPermissionCall = call
                self.locationManager().requestWhenInUseAuthorization() // not "Always": the hike runs because the user started it
            } else {
                self.askNotifications(call)
            }
        }
    }

    private func askNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
            DispatchQueue.main.async { self.withStates { call.resolve($0) } }
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined, let call = pendingPermissionCall else { return }
        pendingPermissionCall = nil
        askNotifications(call)
    }

    @objc func startHike(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Ridgeline hike"
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            guard self.locationState() == "granted" else { call.reject("Location permission is not granted."); return }
            let m = self.locationManager()
            m.desiredAccuracy = kCLLocationAccuracyBestForNavigation
            m.distanceFilter = kCLDistanceFilterNone
            m.activityType = .fitness
            m.pausesLocationUpdatesAutomatically = false
            m.allowsBackgroundLocationUpdates = true      // only between startHike and stopHike
            m.showsBackgroundLocationIndicator = true     // the blue pill/bar while a hike runs
            m.startUpdatingLocation()
            self.lastTitle = ""
            self.post(title: title, body: text)
            call.resolve()
        }
    }

    @objc func stopHike(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let m = self.manager {
                m.stopUpdatingLocation()
                m.allowsBackgroundLocationUpdates = false
                m.showsBackgroundLocationIndicator = false
            }
            let c = UNUserNotificationCenter.current()
            c.removeDeliveredNotifications(withIdentifiers: [self.notificationId])
            c.removePendingNotificationRequests(withIdentifiers: [self.notificationId])
            call.resolve()
        }
    }

    @objc func updateNotification(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        var body = call.getString("text") ?? ""
        if let p = call.getInt("progress"), p >= 0, !body.contains("%") { body += " · \(p)% done" }
        post(title: title, body: body)
        call.resolve()
    }

    /// One notification, replaced in place. Only a new instruction (new title) re-posts, so it does not buzz on every metre.
    private func post(title: String, body: String) {
        guard !title.isEmpty, title != lastTitle else { return }
        lastTitle = title
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let req = UNNotificationRequest(identifier: notificationId, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for l in locations {
            var d: [String: Any] = [
                "lat": l.coordinate.latitude,
                "lon": l.coordinate.longitude,
                "accuracy": l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : 9999,
                "t": Int(l.timestamp.timeIntervalSince1970 * 1000)
            ]
            if l.verticalAccuracy >= 0 { d["altitude"] = l.altitude; d["altitudeAccuracy"] = l.verticalAccuracy }
            if l.speed >= 0 { d["speed"] = l.speed }
            if l.course >= 0 { d["heading"] = l.course }
            notifyListeners("fix", data: d)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code == .denied ? 1 : 2
        notifyListeners("locationError", data: ["code": code, "message": error.localizedDescription])
    }
}
