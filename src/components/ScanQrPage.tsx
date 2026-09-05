import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import jsQR from 'jsqr';
import {
  Camera,
  Image as ImageIcon,
  ClipboardPaste,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Upload,
  VideoOff,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import { Button } from './ui/button';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readImage, readText } from '@tauri-apps/plugin-clipboard-manager';
import { useConfigStore } from '../store/useConfigStore';

export const ScanQrPage: React.FC = () => {
  const { t } = useTranslation();
  const { isScanQrOpen, setIsScanQrOpen, addConfigsFromText, isGroupSubscription, activeGroupId } =
    useConfigStore();

  const [activeTab, setActiveTab] = useState<'camera' | 'file'>('camera');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sessionIdRef = useRef<number>(0);
  const lastScanTimeRef = useRef<number>(0);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    sessionIdRef.current++;
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  }, []);

  // Process a QR result
  const handleDecodedString = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setSuccessText(trimmed);
      stopCamera();

      if (isGroupSubscription(activeGroupId)) {
        setTimeout(() => {
          setIsScanQrOpen(false);
        }, 800);
        return;
      }

      addConfigsFromText(trimmed);

      setTimeout(() => {
        setIsScanQrOpen(false);
      }, 700);
    },
    [addConfigsFromText, isGroupSubscription, activeGroupId, setIsScanQrOpen, stopCamera]
  );

  // Decode QR from ImageData
  const decodeImageData = useCallback(
    (imageData: ImageData): boolean => {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (code && code.data) {
        handleDecodedString(code.data);
        return true;
      }
      return false;
    },
    [handleDecodedString]
  );

  // Live video frame processing loop (throttled & downscaled for 0% UI lag)
  const scanVideoFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const now = performance.now();
    // Scan at 8-10 fps (every ~110ms)
    if (now - lastScanTimeRef.current >= 110 && video.readyState === video.HAVE_ENOUGH_DATA) {
      lastScanTimeRef.current = now;

      const origW = video.videoWidth || 640;
      const origH = video.videoHeight || 480;
      const maxDim = 480;
      const scale = Math.min(1, maxDim / Math.max(origW, origH));
      const scanW = Math.max(200, Math.floor(origW * scale));
      const scanH = Math.max(150, Math.floor(origH * scale));

      if (canvas.width !== scanW || canvas.height !== scanH) {
        canvas.width = scanW;
        canvas.height = scanH;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, scanW, scanH);
        const imageData = ctx.getImageData(0, 0, scanW, scanH);
        const found = decodeImageData(imageData);
        if (found) {
          return;
        }
      }
    }

    animFrameIdRef.current = requestAnimationFrame(scanVideoFrame);
  }, [decodeImageData]);

  // Start webcam stream
  const startCamera = useCallback(
    async (deviceId?: string) => {
      const currentSession = ++sessionIdRef.current;

      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setCameraError(null);
      setSuccessText(null);

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setCameraError(t('noCameraFound'));
          return;
        }

        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (currentSession !== sessionIdRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          const video = videoRef.current;
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          video.muted = true;

          try {
            await video.play();
          } catch (playErr: any) {
            if (playErr.name === 'AbortError') {
              return;
            }
            throw playErr;
          }

          if (currentSession !== sessionIdRef.current) return;
          setIsScanning(true);
          animFrameIdRef.current = requestAnimationFrame(scanVideoFrame);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return;
        }
        console.error('Camera access error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError(t('cameraAccessDenied'));
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setCameraError(t('noCameraFound'));
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setCameraError(t('cameraBusy'));
        } else {
          setCameraError(err.message || t('cameraBusy'));
        }
      }
    },
    [scanVideoFrame, t]
  );

  // Enumerate cameras once on open
  useEffect(() => {
    if (!isScanQrOpen) return;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => {
        const videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setCameras(videoDevices);
      })
      .catch(() => {});
  }, [isScanQrOpen]);

  // Manage camera lifecycle
  useEffect(() => {
    if (isScanQrOpen && activeTab === 'camera') {
      startCamera(selectedCameraId || undefined);
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isScanQrOpen, activeTab, selectedCameraId, startCamera, stopCamera]);

  // Decode an image file
  const processImageFile = useCallback(
    (file: File) => {
      setFileError(null);
      if (!file.type.startsWith('image/')) {
        setFileError(t('noQrFoundInImage'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            handleDecodedString(code.data);
          } else {
            setFileError(t('noQrFoundInImage'));
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    [handleDecodedString, t]
  );

  // Paste image or text from clipboard via 100% Tauri native backend
  const handlePasteImageFromClipboard = useCallback(async () => {
    setFileError(null);

    // 1. Try Tauri native clipboard image reading
    try {
      const image = await readImage();
      if (image) {
        const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
        if (rgba && size.width > 0 && size.height > 0) {
          const clamped = new Uint8ClampedArray(rgba);
          const code = jsQR(clamped, size.width, size.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            handleDecodedString(code.data);
            return;
          }
        }
      }
    } catch (e) {
      console.debug('Tauri readImage error:', e);
    }

    // 2. Check if clipboard has a text config directly
    try {
      const text = await readText();
      if (text && (text.includes('://') || text.includes('{') || text.includes('http'))) {
        handleDecodedString(text);
        return;
      }
    } catch (e) {
      console.debug('Tauri readText error:', e);
    }

    setFileError(t('noQrFoundInImage'));
  }, [handleDecodedString, t]);

  // Tauri v2 native file drop listener
  useEffect(() => {
    if (!isScanQrOpen) return;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === 'drop') {
          setIsDragOver(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            for (const path of paths) {
              const lower = path.toLowerCase();
              if (
                lower.endsWith('.png') ||
                lower.endsWith('.jpg') ||
                lower.endsWith('.jpeg') ||
                lower.endsWith('.webp') ||
                lower.endsWith('.bmp')
              ) {
                try {
                  const bytes = await invoke('read_file_bytes', { path });
                  const uint8 = new Uint8Array(bytes);
                  const blob = new Blob([uint8]);
                  const file = new File([blob], 'dropped-image.png', { type: 'image/png' });
                  processImageFile(file);
                  return;
                } catch (e) {
                  console.error('Failed to read dropped file via Tauri:', e);
                  setFileError(t('noQrFoundInImage'));
                }
              }
            }
          }
        } else if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setIsDragOver(true);
        } else if (event.payload.type === 'leave') {
          setIsDragOver(false);
        }
      })
      .then((un) => {
        unlisten = un;
      })
      .catch((err) => {
        console.debug('onDragDropEvent registration:', err);
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [isScanQrOpen, processImageFile, t]);

  // Global Ctrl+V / Cmd+V listener via Tauri clipboard
  useEffect(() => {
    if (!isScanQrOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        handlePasteImageFromClipboard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScanQrOpen, handlePasteImageFromClipboard]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-transparent select-none p-3 w-full">
      {/* Top Header Bar with Back Button */}
      <div className="flex items-center justify-between pb-3 border-b border-border/50 shrink-0 w-full">
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsScanQrOpen(false)}
            className="h-8 gap-1.5 px-2.5 text-xs font-medium cursor-pointer"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            <span>{t('backToApp')}</span>
          </Button>
          <div>
            <h1 className="text-sm font-bold flex items-center gap-1.5 text-foreground">
              <Sparkles className="size-4 text-emerald-500" />
              <span>{t('scanQrTitle')}</span>
            </h1>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/60 rounded-lg border border-border/40 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className={`flex items-center justify-center gap-1.5 py-1 px-3 rounded-md transition-all cursor-pointer ${
              activeTab === 'camera'
                ? 'bg-background shadow-xs text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Camera className="size-3.5 text-blue-500" />
            <span>{t('cameraScan')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('file')}
            className={`flex items-center justify-center gap-1.5 py-1 px-3 rounded-md transition-all cursor-pointer ${
              activeTab === 'file'
                ? 'bg-background shadow-xs text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ImageIcon className="size-3.5 text-emerald-500" />
            <span>{t('fileOrClipboard')}</span>
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Main Content View */}
      <div className="flex-1 flex flex-col justify-center items-center py-6 overflow-y-auto min-h-0 w-full">
        {/* TAB 1: Camera Live Scanner */}
        {activeTab === 'camera' && (
          <div className="w-full max-w-xl space-y-3">
            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black/90 flex items-center justify-center border border-border/50 shadow-lg">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />

              {/* Live Targeting Reticle & Scanner Line */}
              {isScanning && !successText && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="relative size-48 sm:size-56 border-2 border-emerald-400/90 rounded-2xl shadow-[0_0_20px_rgba(52,211,153,0.3)]">
                    <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse shadow-[0_0_8px_#34d399] top-1/2 -translate-y-1/2" />
                    <div className="absolute top-0 left-0 size-3 border-t-2 border-l-2 border-white rounded-tl-sm" />
                    <div className="absolute top-0 right-0 size-3 border-t-2 border-r-2 border-white rounded-tr-sm" />
                    <div className="absolute bottom-0 left-0 size-3 border-b-2 border-l-2 border-white rounded-bl-sm" />
                    <div className="absolute bottom-0 right-0 size-3 border-b-2 border-r-2 border-white rounded-br-sm" />
                  </div>
                </div>
              )}

              {/* Success Overlay (Translucent) */}
              {successText && (
                <div className="absolute inset-0 bg-emerald-950/40 backdrop-blur-xs flex flex-col items-center justify-center text-emerald-300 p-4 text-center animate-in zoom-in-95 duration-150">
                  <CheckCircle2 className="size-12 mb-2 text-emerald-400 animate-bounce" />
                  <p className="text-sm font-semibold">{t('scanSuccess')}</p>
                </div>
              )}

              {/* Camera Error State */}
              {cameraError && (
                <div className="absolute inset-0 bg-background/95 p-6 flex flex-col items-center justify-center text-center gap-3">
                  <VideoOff className="size-10 text-destructive opacity-80" />
                  <p className="text-xs text-destructive font-medium px-4">{cameraError}</p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => startCamera(selectedCameraId || undefined)}
                      className="h-8 text-xs gap-1.5"
                    >
                      <RefreshCw className="size-3" />
                      <span>{t('retry')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setActiveTab('file')}
                      className="h-8 text-xs gap-1.5"
                    >
                      <ImageIcon className="size-3" />
                      <span>{t('fileOrClipboard')}</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Camera selector & Status */}
            <div className="flex items-center justify-between gap-2 text-xs px-1">
              <div className="flex items-center gap-1.5 text-muted-foreground truncate">
                <span className="relative flex size-2 shrink-0">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      isScanning ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full size-2 ${
                      isScanning ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                </span>
                <span className="truncate text-[11px]">
                  {isScanning ? t('scanningCamera') : t('scanningCameraHint')}
                </span>
              </div>

              {cameras.length > 1 && (
                <select
                  value={selectedCameraId}
                  onChange={(e) => {
                    setSelectedCameraId(e.target.value);
                    startCamera(e.target.value);
                  }}
                  className="bg-card border border-border/50 rounded px-2.5 py-1 text-[11px] outline-none max-w-[160px] truncate"
                >
                  <option value="">{t('defaultCamera')}</option>
                  {cameras.map((c, i) => (
                    <option key={c.deviceId || i} value={c.deviceId}>
                      {c.label || `${t('cameraScan')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Image File / Clipboard Scanner */}
        {activeTab === 'file' && (
          <div className="w-full max-w-xl space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processImageFile(file);
              }}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) processImageFile(file);
              }}
              className={`relative overflow-hidden border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all gap-3 ${
                successText
                  ? 'border-emerald-500 bg-emerald-500/15'
                  : isDragOver
                  ? 'border-emerald-500 bg-emerald-500/10 scale-[1.01]'
                  : 'border-border/70 hover:border-emerald-500/60 bg-muted/20 hover:bg-muted/40'
              }`}
            >
              {successText ? (
                <div className="flex flex-col items-center justify-center text-emerald-400 py-3 animate-in zoom-in-95 duration-150">
                  <CheckCircle2 className="size-12 mb-2 text-emerald-400 animate-bounce" />
                  <p className="text-sm font-semibold text-emerald-400">{t('scanSuccess')}</p>
                </div>
              ) : (
                <>
                  <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-500">
                    <Upload className="size-8" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t('dropImageHere')}</p>
                    <p className="text-xs text-muted-foreground/80 mt-1">{t('pasteImageHint')}</p>
                  </div>
                </>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full gap-2 text-xs font-semibold cursor-pointer h-10"
              onClick={handlePasteImageFromClipboard}
            >
              <ClipboardPaste className="size-4 text-blue-500" />
              <span>{t('pasteImage')}</span>
            </Button>

            {fileError && (
              <div className="flex items-center gap-2 text-destructive text-xs font-medium bg-destructive/10 p-3 rounded-xl border border-destructive/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>{fileError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
