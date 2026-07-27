'use client';

import { useState } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { PreviewImage } from '@/lib/tasks';
import { downloadFile } from '@/lib/format';

interface LightboxProps {
  image: PreviewImage | null;
  onClose: () => void;
}

export function Lightbox({ image, onClose }: LightboxProps) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDownload = async () => {
    if (!image?.url || downloading) return;
    setDownloading(true);
    try {
      await downloadFile(image.url, image.fileName);
    } catch {
      // ignore
    } finally {
      setDownloading(false);
    }
  };

  const handleCopy = async () => {
    if (!image?.url) return;
    try {
      await navigator.clipboard.writeText(image.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border bg-panel p-0">
        <DialogTitle className="sr-only">
          {image ? `图片 ${image.label} 预览` : '图片预览'}
        </DialogTitle>
        {image && (
          <div className="flex flex-col">
            <div className="relative flex max-h-[70vh] items-center justify-center bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.prompt}
                className="max-h-[70vh] w-full object-contain"
              />
              <span className="absolute left-3 top-3 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-sm">
                {image.label}
              </span>
            </div>
            <div className="flex items-center gap-3 border-t border-border px-4 py-3">
              <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                {image.prompt}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-faint"
                >
                  {copied ? (
                    <Check className="size-3.5 text-success" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  复制链接
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-signal px-3 text-[11px] font-medium text-signal-foreground transition-colors hover:bg-signal/90 disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  下载
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
