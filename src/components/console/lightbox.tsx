'use client';

import { useState } from 'react';
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
      <DialogContent className="max-w-3xl gap-0 overflow-hidden rounded-sm border-foreground bg-raised p-0">
        <DialogTitle className="sr-only">
          {image ? `图片 ${image.label} 预览` : '图片预览'}
        </DialogTitle>
        {image && (
          <div className="flex flex-col">
            <div className="relative flex max-h-[70vh] items-center justify-center bg-sunk">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.prompt}
                className="max-h-[70vh] w-full object-contain"
              />
              <span className="pointer-events-none absolute left-0 top-0 bg-foreground px-[9px] py-1 text-xs tracking-[0.06em] tabular-nums text-paper">
                {image.label}
              </span>
            </div>
            <div className="flex items-center gap-4 border-t border-rule px-4 py-3">
              <p className="line-clamp-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                {image.prompt}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-sm border border-foreground bg-transparent px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-foreground hover:text-paper"
                >
                  {copied ? '已复制' : '复制链接'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="rounded-sm bg-signal px-4 py-1.5 text-[13px] text-signal-foreground transition-colors hover:bg-teal-deep disabled:opacity-50"
                >
                  {downloading ? '下载中…' : '下载'}
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
