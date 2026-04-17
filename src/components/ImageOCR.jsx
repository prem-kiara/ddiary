import { useState, useRef, useEffect } from 'react';
import { X, Image, Camera, RotateCw } from 'lucide-react';

export default function ImageOCR({ onTextExtracted, onClose }) {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [extractedText, setExtractedText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ocrReady, setOcrReady] = useState(false);
  const fileRef = useRef(null);
  const workerRef = useRef(null);

  useEffect(() => {
    // Dynamically load Tesseract.js
    const loadTesseract = async () => {
      try {
        const Tesseract = await import('tesseract.js');
        workerRef.current = Tesseract;
        setOcrReady(true);
      } catch (err) {
        console.error('Failed to load Tesseract:', err);
        // Fallback: try CDN
        if (!window.Tesseract) {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          script.onload = () => {
            workerRef.current = window.Tesseract;
            setOcrReady(true);
          };
          document.head.appendChild(script);
        } else {
          workerRef.current = window.Tesseract;
          setOcrReady(true);
        }
      }
    };
    loadTesseract();
  }, []);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage(file);
    setExtractedText('');
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const runOCR = async () => {
    if (!preview || !workerRef.current) return;
    setProcessing(true);
    setProgress(0);

    try {
      const Tesseract = workerRef.current;
      const result = await Tesseract.recognize(preview, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round(m.progress * 100));
          }
        }
      });
      setExtractedText(result.data.text.trim());
    } catch (err) {
      console.error('OCR error:', err);
      setExtractedText('OCR processing failed. You can type your text manually in the box below.');
    }
    setProcessing(false);
  };

  const handleUseText = () => {
    if (extractedText.trim()) {
      onTextExtracted(extractedText.trim());
    }
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: "var(--font-body)", fontSize: 26, color: '#0f172a' }}>
            Upload Handwritten Notes
          </h3>
          <button className="btn-icon" onClick={onClose}><X size={22} /></button>
        </div>

        {!preview ? (
          <div className="upload-zone" onClick={() => fileRef.current?.click()}>
            <Image size={48} color="#7c3aed" style={{ marginBottom: 12 }} />
            <p style={{ color: '#6d28d9', fontFamily: "'Georgia', serif", fontWeight: 600, marginBottom: 4 }}>
              Tap to upload an image
            </p>
            <p style={{ color: '#aaa', fontSize: 13 }}>
              Supports JPG, PNG, HEIC — photos of handwritten notes work best
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
          </div>
        ) : (
          <div className="fade-in">
            <img
              src={preview}
              alt="Preview"
              style={{ width: '100%', borderRadius: 8, marginBottom: 12, border: '1px solid #e2e8f0', maxHeight: 300, objectFit: 'contain', background: '#f1f5f9' }}
            />

            {!extractedText && (
              <>
                {processing && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ background: '#e2e8f0', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                      <div style={{ background: '#6d28d9', height: '100%', width: `${progress}%`, transition: 'width 0.3s', borderRadius: 6 }} />
                    </div>
                    <p style={{ textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 6 }}>
                      Recognizing handwriting... {progress}%
                    </p>
                  </div>
                )}
                <button
                  className="btn btn-gold"
                  onClick={runOCR}
                  disabled={processing || !ocrReady}
                  style={{ width: '100%', justifyContent: 'center', fontSize: 16 }}
                >
                  {processing ? (
                    <><RotateCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing...</>
                  ) : !ocrReady ? (
                    'Loading OCR engine...'
                  ) : (
                    <><Camera size={16} /> Convert Handwriting to Text</>
                  )}
                </button>
              </>
            )}

            {extractedText && (
              <div className="fade-in" style={{ marginTop: 12 }}>
                <label className="label">Extracted Text (you can edit before adding):</label>
                <textarea
                  className="textarea"
                  value={extractedText}
                  onChange={e => setExtractedText(e.target.value)}
                  rows={6}
                  style={{ minHeight: 120 }}
                />
                <button
                  className="btn btn-teal"
                  onClick={handleUseText}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12, fontSize: 16 }}
                >
                  Add to Diary Entry
                </button>
              </div>
            )}

            <button
              className="btn btn-outline"
              onClick={() => { setPreview(null); setImage(null); setExtractedText(''); setProgress(0); }}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            >
              Choose Different Image
            </button>
          </div>
        )}

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
