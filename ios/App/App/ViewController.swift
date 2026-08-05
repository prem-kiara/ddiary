import UIKit
import Capacitor

/// Hosts the web app and registers our local native plugins.
///
/// Capacitor auto-discovers plugins that ship as npm packages, but a plugin
/// written directly in the app target has to be registered by hand — this is
/// the documented hook for it.
class ViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeInkPlugin())
    }
}
