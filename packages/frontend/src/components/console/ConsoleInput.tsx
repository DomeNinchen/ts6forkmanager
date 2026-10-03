import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tsEscape, tsUnescape } from '@ts6/common';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  analyzeInput,
  applySuggestion,
  entitySuggestions,
  type Completion,
  type Suggestion,
} from '@/lib/console/completion';
import { useEntityList } from '@/lib/console/entities';

interface ConsoleInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Reports what the caret is in, for the help panel next to the input. */
  onAnalysis?: (completion: Completion) => void;
  history: string[];
  configId: number | null;
  sid: number;
  disabled?: boolean;
  placeholder?: string;
  /** Off for plain text (the message modes), where nothing is a command to complete. */
  completionEnabled?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

const NO_COMPLETION: Completion = { from: 0, to: 0, context: 'none', suggestions: [], prefix: '' };

const isBreak = (ch: string): boolean => /\s/.test(ch) || ch === '|';

/** One-line input for ServerQuery commands: autocomplete, value picking (Ctrl+Space), escaping (Ctrl+E) and history (arrow keys). */
export function ConsoleInput({
  value,
  onChange,
  onSubmit,
  onAnalysis,
  history,
  configId,
  sid,
  disabled,
  placeholder,
  completionEnabled = true,
  inputRef,
}: ConsoleInputProps) {
  const { t } = useTranslation();
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [forced, setForced] = useState(false);
  const [active, setActive] = useState(0);
  // Enter only accepts a suggestion once the arrow keys have moved onto one; otherwise it runs the command.
  const [navigated, setNavigated] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draft = useRef('');
  const listRef = useRef<HTMLDivElement>(null);

  const completion = useMemo(
    () => (completionEnabled ? analyzeInput(value, caret, forced) : NO_COMPLETION),
    [value, caret, forced, completionEnabled],
  );

  useEffect(() => {
    onAnalysis?.(completion);
  }, [completion, onAnalysis]);

  // Values that come from the server's own data (channels, clients, groups ...): only fetched while they are being asked for.
  const wantsEntities = completionEnabled && open && completion.context === 'value' && completion.suggestions.length === 0;
  const entities = useEntityList(completion.entity ?? null, configId, sid, wantsEntities);

  const suggestions: Suggestion[] = useMemo(() => {
    if (completion.suggestions.length > 0) return completion.suggestions;
    if (completion.entity && completion.param && entities.data) {
      return entitySuggestions(entities.data, completion.prefix, completion.param.key);
    }
    return [];
  }, [completion, entities.data]);

  const showPopup = open && suggestions.length > 0 && !disabled;

  // Over the transcript, above the input, is the natural place for the list - the input sits at the bottom
  // of the page, so a list below it would often run off the screen. It goes below only where there is
  // clearly more room, and is never taller than the room it has.
  const [placement, setPlacement] = useState({ above: true, maxHeight: 288 });
  useLayoutEffect(() => {
    if (!showPopup) return;
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const roomAbove = rect.top - 8;
    const roomBelow = window.innerHeight - rect.bottom - 8;
    const above = roomAbove >= Math.min(288, roomBelow);
    setPlacement({ above, maxHeight: Math.max(96, Math.min(288, above ? roomAbove : roomBelow)) });
  }, [showPopup, suggestions.length, inputRef]);

  useEffect(() => {
    setActive(0);
    setNavigated(false);
  }, [suggestions.length, completion.from, completion.prefix]);

  useEffect(() => {
    if (!showPopup) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, showPopup]);

  /** Puts the selection (or, when both ends are equal, the caret) in place once the input has its new text. */
  const select = (start: number, end: number) => {
    // The suggestions follow the caret at once; the input itself catches up a moment later.
    setCaret(end);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(start, end);
    });
  };
  const moveCaret = (position: number) => select(position, position);

  const accept = (suggestion: Suggestion) => {
    const next = applySuggestion(value, completion, suggestion);
    onChange(next.text);
    setOpen(true);
    setForced(false);
    setHistoryIndex(null);
    moveCaret(next.caret);
  };

  /** Escapes the selected text, or unescapes it if it already contains escapes; with no selection, the value the caret is in. */
  const toggleEscape = () => {
    const input = inputRef.current;
    if (!input) return;
    let from = input.selectionStart ?? 0;
    let to = input.selectionEnd ?? 0;
    if (from === to) {
      let start = from;
      while (start > 0 && !isBreak(value[start - 1])) start--;
      let end = from;
      while (end < value.length && !isBreak(value[end])) end++;
      const eq = value.slice(start, end).indexOf('=');
      if (eq === -1) return;
      from = start + eq + 1;
      to = end;
    }
    const segment = value.slice(from, to);
    const replaced = /\\[\\\/spabfnrtv]/.test(segment) ? tsUnescape(segment) : tsEscape(segment);
    onChange(value.slice(0, from) + replaced + value.slice(to));
    // Left selected, so that pressing Ctrl+E again turns it back - once unescaped, a value can contain
    // spaces and pipes, which would otherwise make it impossible to tell where it ends.
    select(from, from + replaced.length);
  };

  const recall = (direction: -1 | 1) => {
    if (history.length === 0) return;
    if (historyIndex === null) {
      if (direction === 1) return;
      draft.current = value;
    }
    const current = historyIndex ?? history.length;
    const next = current + direction;
    setOpen(false);
    if (next >= history.length) {
      setHistoryIndex(null);
      onChange(draft.current);
      moveCaret(draft.current.length);
      return;
    }
    const index = Math.max(0, next);
    setHistoryIndex(index);
    onChange(history[index]);
    moveCaret(history[index].length);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
      event.preventDefault();
      setForced(true);
      setOpen(true);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      toggleEscape();
      return;
    }

    if (showPopup) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setNavigated(true);
        setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && navigated)) {
        event.preventDefault();
        accept(suggestions[Math.min(active, suggestions.length - 1)]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        setForced(false);
        return;
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      setOpen(false);
      setForced(false);
      setHistoryIndex(null);
      onSubmit();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      recall(event.key === 'ArrowUp' ? -1 : 1);
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        role="combobox"
        aria-autocomplete="list"
        aria-label={t('pages.console.input.label')}
        aria-expanded={showPopup}
        className="h-10 font-mono"
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setHistoryIndex(null);
          setOpen(true);
          setForced(false);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onBlur={() => setOpen(false)}
      />

      {showPopup && (
        <div
          ref={listRef}
          role="listbox"
          style={{ maxHeight: placement.maxHeight }}
          className={cn(
            'absolute left-0 right-0 z-30 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
            placement.above ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
          // Keep the focus in the input: a click on a row must not blur it first.
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.kind}:${suggestion.insert}`}
              type="button"
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              className={cn(
                'flex w-full items-baseline gap-2 px-3 py-1.5 text-left font-mono text-sm',
                index === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
              onClick={() => accept(suggestion)}
              onMouseEnter={() => setActive(index)}
            >
              <span className={cn(suggestion.badges?.includes('required') && 'font-semibold')}>{suggestion.label}</span>
              {suggestion.detail && <span className="truncate font-sans text-xs text-muted-foreground">{suggestion.detail}</span>}
              <span className="ml-auto flex shrink-0 gap-1 font-sans text-[10px] uppercase tracking-wide">
                {suggestion.badges?.includes('danger') && <span className="text-destructive">{t('pages.console.suggest.danger')}</span>}
                {suggestion.badges?.includes('hidden') && <span className="text-muted-foreground">{t('pages.console.suggest.hidden')}</span>}
                {suggestion.badges?.includes('alias') && <span className="text-muted-foreground">{t('pages.console.suggest.alias')}</span>}
                {suggestion.badges?.includes('repeatable') && <span className="text-muted-foreground">{'…'}</span>}
                {suggestion.badges?.includes('required') && <span className="text-primary">{t('pages.console.suggest.required')}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
