import * as React from 'react';
import { cn } from '@/lib/utils';

let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * A placeholder wider than its field (long languages, phone width) scrolls slowly back and forth
 * instead of being cut off mid-word: the input gets `data-ph-overflow` and `--ph-shift`, and the
 * animation in globals.css runs while the placeholder shows and the field is not focused.
 */
function usePlaceholderMarquee(el: React.RefObject<HTMLInputElement | null>, placeholder: string | undefined) {
  React.useLayoutEffect(() => {
    const input = el.current;
    if (!input || !placeholder) return;
    const measure = () => {
      if (!input.clientWidth) return;
      const cs = getComputedStyle(input);
      measureCtx ??= document.createElement('canvas').getContext('2d');
      if (!measureCtx) return;
      measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const shift = Math.ceil(measureCtx.measureText(placeholder).width - room);
      if (shift > 1) {
        input.dataset.phOverflow = '';
        input.style.setProperty('--ph-shift', `${shift}px`);
        input.style.setProperty('--ph-duration', `${Math.max(3, shift / 20)}s`);
      } else {
        delete input.dataset.phOverflow;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [el, placeholder]);
}

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, placeholder, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
    usePlaceholderMarquee(inner, placeholder);
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        placeholder={placeholder}
        ref={inner}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
