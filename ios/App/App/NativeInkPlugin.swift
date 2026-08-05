import Foundation
import Capacitor

/// Bridges the web app to the native PencilKit surface.
///
/// The web app keeps everything it already does — diary, sheets, tasks, sync,
/// export. Only the handwriting surface is handed to the OS, because that is
/// the one part a browser canvas cannot make fast enough: a web canvas receives
/// roughly one pointer sample per frame at 60 fps, while PencilKit gets the
/// pen's full rate plus Apple's predicted touches at 120 Hz.
///
/// JS: const { drawing, png, cancelled } = await NativeInk.open({ drawing })
@objc(NativeInkPlugin)
public class NativeInkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeInkPlugin"
    public let jsName = "NativeInk"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
    ]

    /// True whenever the native surface can be used, so the web app can fall
    /// back to its own canvas on any platform where it cannot.
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func open(_ call: CAPPluginCall) {
        let initial = call.getString("drawing")

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let presenter = self.bridge?.viewController else {
                call.reject("No view controller available to present on")
                return
            }

            let vc = InkViewController()
            vc.initialDrawingBase64 = initial
            vc.modalPresentationStyle = .fullScreen

            vc.onDone = { drawingB64, pngB64 in
                call.resolve([
                    "cancelled": false,
                    "drawing": drawingB64 ?? "",
                    "png": pngB64 ?? "",
                ])
            }
            vc.onCancel = {
                call.resolve(["cancelled": true])
            }

            presenter.present(vc, animated: true)
        }
    }
}
