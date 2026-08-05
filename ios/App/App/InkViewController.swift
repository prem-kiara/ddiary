import UIKit
import PencilKit

/// Full-screen PencilKit writing surface.
///
/// PKCanvasView is the same component Apple Notes uses. It receives Apple
/// Pencil input at the pen's full report rate, applies Apple's own predicted
/// touches, and renders through a dedicated low-latency path — none of which is
/// reachable from a web canvas, which is why the browser version trails the nib
/// when writing quickly no matter how the JavaScript is optimised.
///
/// The controller is deliberately dumb: it shows a canvas, hands back the
/// drawing, and knows nothing about diary entries.
class InkViewController: UIViewController {

    /// Existing drawing to reopen, as base64 of PKDrawing.dataRepresentation().
    var initialDrawingBase64: String?

    /// (drawingBase64, pngBase64) — png is for previews and email, where the
    /// vector form cannot be rendered.
    var onDone: ((String?, String?) -> Void)?
    var onCancel: (() -> Void)?

    private let canvasView = PKCanvasView()
    private var toolPicker: PKToolPicker?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        canvasView.translatesAutoresizingMaskIntoConstraints = false
        canvasView.backgroundColor = .white
        canvasView.alwaysBounceVertical = true
        // Finger draws as well as the Pencil; the toolbar toggle below flips
        // this so a finger can scroll instead — the same choice the web
        // version exposes, but here the OS enforces it.
        canvasView.drawingPolicy = .anyInput

        if let b64 = initialDrawingBase64,
           let data = Data(base64Encoded: b64),
           let drawing = try? PKDrawing(data: data) {
            canvasView.drawing = drawing
        }

        let bar = makeToolbar()
        view.addSubview(bar)
        view.addSubview(canvasView)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 52),

            canvasView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            canvasView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            canvasView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            canvasView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // The system tool picker (pens, colours, undo, ruler) — the same one
        // Notes shows, for free.
        if let window = view.window {
            let picker = PKToolPicker.shared(for: window) ?? PKToolPicker()
            picker.setVisible(true, forFirstResponder: canvasView)
            picker.addObserver(canvasView)
            canvasView.becomeFirstResponder()
            toolPicker = picker
        }
    }

    private func makeToolbar() -> UIView {
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = .secondarySystemBackground

        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        let done = UIButton(type: .system)
        done.setTitle("Done", for: .normal)
        done.titleLabel?.font = .boldSystemFont(ofSize: 17)
        done.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)

        let stylusOnly = UISwitch()
        stylusOnly.addTarget(self, action: #selector(stylusOnlyChanged(_:)), for: .valueChanged)
        let stylusLabel = UILabel()
        stylusLabel.text = "Stylus only"
        stylusLabel.font = .systemFont(ofSize: 14)
        stylusLabel.textColor = .secondaryLabel

        let stack = UIStackView(arrangedSubviews: [cancel, UIView(), stylusLabel, stylusOnly, UIView(), done])
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            stack.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
        ])
        return bar
    }

    @objc private func stylusOnlyChanged(_ sender: UISwitch) {
        canvasView.drawingPolicy = sender.isOn ? .pencilOnly : .anyInput
    }

    @objc private func cancelTapped() {
        dismiss(animated: true) { [weak self] in self?.onCancel?() }
    }

    @objc private func doneTapped() {
        let drawing = canvasView.drawing
        let b64 = drawing.dataRepresentation().base64EncodedString()

        // A raster copy for previews, email and any non-Apple client. Bounded
        // so a large canvas cannot produce an unreasonable payload.
        var pngB64: String?
        let bounds = drawing.bounds
        if !bounds.isEmpty {
            let scale = min(2.0, 2_000 / max(bounds.width, bounds.height, 1))
            let image = drawing.image(from: bounds, scale: scale)
            pngB64 = image.pngData()?.base64EncodedString()
        }

        dismiss(animated: true) { [weak self] in self?.onDone?(b64, pngB64) }
    }
}
