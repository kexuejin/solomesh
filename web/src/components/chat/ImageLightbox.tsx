import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useI18n } from '../../i18n';

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const { t } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translateY, setTranslateY] = useState(0);
  const [bgOpacity, setBgOpacity] = useState(1);
  const [isClosing, setIsClosing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const touchStartRef = useRef({ x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const isDraggingRef = useRef(false);

  // Open animation
  useEffect(() => {
    requestAnimationFrame(() => setIsOpen(true));
  }, []);

  // Lock scroll while lightbox is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setIsOpen(false);
    setTimeout(() => onClose(), 300);
  }, [onClose]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
    setScale(1);
    setTranslateY(0);
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(images.length - 1, prev + 1));
    setScale(1);
    setTranslateY(0);
  }, [images.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
        return;
      }
      if (event.key === 'ArrowLeft' && currentIndex > 0) {
        handlePrev();
      } else if (event.key === 'ArrowRight' && currentIndex < images.length - 1) {
        handleNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentIndex, images.length, handleClose, handleNext, handlePrev]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    isDraggingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dy = touch.clientY - touchStartRef.current.y;

    // Pull-down to close only when not zoomed
    if (scale === 1 && dy > 0) {
      isDraggingRef.current = true;
      setTranslateY(dy);
      setBgOpacity(Math.max(0, 1 - dy / 400));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    // Pull-down close
    if (isDraggingRef.current && translateY > 150) {
      handleClose();
      return;
    }

    // Reset pull-down state
    if (isDraggingRef.current) {
      setTranslateY(0);
      setBgOpacity(1);
      isDraggingRef.current = false;
      return;
    }

    // Swipe left/right to switch images
    if (Math.abs(dx) > 50 && Math.abs(dy) < 50 && scale === 1) {
      if (dx < 0 && currentIndex < images.length - 1) {
        handleNext();
      } else if (dx > 0 && currentIndex > 0) {
        handlePrev();
      }
      return;
    }

    // Double-tap zoom
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setScale(scale === 1 ? 2 : 1);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  const overlayStyle = {
    opacity: isOpen && !isClosing ? bgOpacity : 0,
    transition: isDraggingRef.current ? 'none' : 'opacity 300ms ease',
  };

  const imageStyle = {
    transform: `translateY(${translateY}px) scale(${scale})`,
    transition: isDraggingRef.current ? 'none' : 'transform 300ms ease',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      onClick={handleClose}
    >
      {/* Background overlay */}
      <div
        className="absolute inset-0 bg-slate-950/92 backdrop-blur-sm"
        style={overlayStyle}
      />

      <button
        onClick={handleClose}
        className="absolute right-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/12 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        aria-label={t('chat.imageLightbox.close')}
      >
        <X className="h-5 w-5" />
      </button>

      {/* Image */}
      <div
        className="relative z-10 flex h-full w-full items-center justify-center p-4 sm:p-6"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className="absolute left-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
              aria-label={t('chat.imageLightbox.prev')}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={currentIndex === images.length - 1}
              className="absolute right-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
              aria-label={t('chat.imageLightbox.next')}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
        <img
          src={images[currentIndex]}
          alt={`${currentIndex + 1} / ${images.length}`}
          className="max-h-[88vh] max-w-[92vw] select-none rounded-xl border border-white/15 bg-white/6 object-contain shadow-[0_30px_70px_rgba(0,0,0,0.5)]"
          style={imageStyle}
          draggable={false}
        />
      </div>

      {/* Page indicator */}
      {images.length > 1 && (
        <div
          className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1 text-sm text-white backdrop-blur-sm"
          style={{ opacity: isOpen && !isClosing ? 1 : 0, transition: 'opacity 300ms ease' }}
        >
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>,
    document.body
  );
}
