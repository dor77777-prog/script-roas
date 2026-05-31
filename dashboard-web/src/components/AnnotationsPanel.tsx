'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Pin,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Calendar,
  Store as StoreIcon,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Heading } from '@/components/ui/Typography';
import {
  ANNOTATION_KIND_COLOR,
  ANNOTATION_KIND_EMOJI,
  ANNOTATION_KIND_LABEL,
  annotationsInScope,
  generateAnnotationId,
  readAnnotations,
  writeAnnotations,
  type Annotation,
  type AnnotationKind,
} from '@/lib/annotations';

/**
 * Annotations panel — log events + view past ones, scoped to the current
 * date range and store filter.
 *
 * The panel itself is a collapsible card. Clicking the "+" opens an inline
 * form; existing annotations list below with edit/delete on hover. A small
 * stat in the header shows how many events fall in the current scope.
 *
 * Annotations are also consumed by RoasChart (via the global readAnnotations
 * helper) — that's where they really shine.
 */

type Props = {
  range: { from: string; to: string };
  store: string;
};

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function AnnotationsPanel({ range, store }: Props) {
  const [items, setItems] = useState<Annotation[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    setItems(readAnnotations());
    function onChange() { setItems(readAnnotations()); }
    window.addEventListener('roas-annotations-changed', onChange);
    return () => window.removeEventListener('roas-annotations-changed', onChange);
  }, []);

  const inScope = useMemo(
    () => annotationsInScope(items, range, store),
    [items, range, store],
  );

  function commit(a: Annotation) {
    const next = items.some(x => x.id === a.id)
      ? items.map(x => (x.id === a.id ? a : x))
      : [a, ...items];
    setItems(next);
    writeAnnotations(next);
  }
  function remove(id: string) {
    const next = items.filter(x => x.id !== id);
    setItems(next);
    writeAnnotations(next);
  }

  return (
    <section className="rounded-2xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
      {/* Clickable header */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={cn(
          'w-full justify-start h-auto text-start px-4 sm:px-5 py-3',
          'border-b border-glass-edge',
          'bg-gradient-to-l from-accent-bg to-glass-1',
          'hover:from-accent-soft hover:to-glass-2/40',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-bg text-accent shrink-0">
              <Pin size={15} />
            </span>
            <div className="min-w-0">
              <Heading level="section" className="font-bold">
                יומן אירועים
              </Heading>
              <div className="text-[11px] sm:text-xs text-ink-muted mt-0.5 leading-tight">
                {inScope.length === 0
                  ? 'תיעד שינויים שהוצעו (השקות, מבצעים, שינויי תקציב) — יוצגו על הגרף'
                  : `${inScope.length} ${inScope.length === 1 ? 'אירוע' : 'אירועים'} בטווח שבחרת`}
              </div>
            </div>
          </div>
          <span
            className="text-ink-muted text-[10px] sm:text-xs tabular-nums shrink-0"
            aria-hidden
          >
            {open ? '▼' : '◀'}
          </span>
        </div>
      </Button>

      {open && (
        <div className="p-4 sm:p-5 space-y-3 animate-fade-in">
          {/* Add-new toolbar */}
          {!adding ? (
            <Button
              variant="ghost"
              onClick={() => setAdding(true)}
              className="w-full justify-center gap-1.5 rounded-lg border border-dashed border-glass-edge bg-glass-2/40 hover:bg-glass-2 hover:border-accent px-3 py-2 h-auto text-xs sm:text-sm font-medium text-ink-secondary hover:text-ink"
            >
              <Plus size={14} />
              תעד אירוע חדש
            </Button>
          ) : (
            <AnnotationForm
              storeOptions={store === 'All' ? [] : [store]}
              onSave={a => { commit(a); setAdding(false); }}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* List of in-scope annotations */}
          {inScope.length === 0 ? (
            <div className="text-center py-6 text-ink-muted text-xs">
              אין אירועים בטווח הזה.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {inScope.map(a => (
                <li
                  key={a.id}
                  className="rounded-lg border border-glass-edge bg-glass-1 hover:bg-glass-2/30 transition-colors"
                >
                  {editing === a.id ? (
                    <AnnotationForm
                      item={a}
                      storeOptions={store === 'All' ? [] : [store]}
                      onSave={updated => { commit(updated); setEditing(null); }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-3 p-2.5">
                      <HelpTooltip content={ANNOTATION_KIND_LABEL[a.kind]}>
                        <span
                          className="text-base shrink-0 grid place-items-center w-7 h-7 rounded"
                          style={{
                            background: ANNOTATION_KIND_COLOR[a.kind] + '15',
                            color: ANNOTATION_KIND_COLOR[a.kind],
                          }}
                          aria-label={ANNOTATION_KIND_LABEL[a.kind]}
                        >
                          <span>{ANNOTATION_KIND_EMOJI[a.kind]}</span>
                        </span>
                      </HelpTooltip>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-ink truncate">
                            {a.title}
                          </span>
                          <span className="text-[10px] text-ink-muted tabular-nums">
                            {formatDate(a.date)}
                          </span>
                          {a.store && (
                            <span className="text-[10px] text-ink-muted inline-flex items-center gap-0.5">
                              <StoreIcon size={9} /> {a.store}
                            </span>
                          )}
                        </div>
                        {a.notes && (
                          <div className="text-[11px] text-ink-secondary mt-0.5 leading-snug">
                            {a.notes}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing(a.id)}
                          aria-label="ערוך"
                          className="w-8 h-8"
                        >
                          <Edit3 size={13} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(a.id)}
                          aria-label="מחק"
                          className="w-8 h-8 text-ink-muted hover:text-status-red hover:bg-status-redBg"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function AnnotationForm({
  item,
  storeOptions,
  onSave,
  onCancel,
}: {
  item?: Annotation;
  storeOptions: string[];
  onSave: (a: Annotation) => void;
  onCancel: () => void;
}) {
  const today = todayInIsrael();
  const [date, setDate] = useState(item?.date ?? today);
  const [kind, setKind] = useState<AnnotationKind>(item?.kind ?? 'launch');
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [scopedStore, setScopedStore] = useState(item?.store ?? '');

  function commit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave({
      id: item?.id ?? generateAnnotationId(),
      date,
      kind,
      title: trimmed,
      notes: notes.trim() || undefined,
      store: scopedStore || undefined,
      createdAt: item?.createdAt ?? Date.now(),
    });
  }

  return (
    <div className="p-3 space-y-2 bg-glass-2/40 rounded-lg border border-glass-edge">
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-end">
        <div>
          <label className="text-[11px] sm:text-[10px] text-ink-muted uppercase tracking-wide font-medium">סוג</label>
          <NativeSelect
            value={kind}
            onChange={e => setKind(e.target.value as AnnotationKind)}
          >
            {(Object.keys(ANNOTATION_KIND_LABEL) as AnnotationKind[]).map(k => (
              <option key={k} value={k}>
                {ANNOTATION_KIND_EMOJI[k]} {ANNOTATION_KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="text-[11px] sm:text-[10px] text-ink-muted uppercase tracking-wide font-medium">כותרת</label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            placeholder='לדוגמה: "השקת מבצע חורף"'
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
        <div>
          <label className="text-[11px] sm:text-[10px] text-ink-muted uppercase tracking-wide font-medium">תאריך</label>
          <Input
            type="date"
            value={date}
            max={today}
            onChange={e => setDate(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="text-[11px] sm:text-[10px] text-ink-muted uppercase tracking-wide font-medium">הערות (אופציונלי)</label>
        <Input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="מה השתנה ולמה — קצר וברור"
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      {storeOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-[11px] sm:text-[10px] text-ink-muted uppercase tracking-wide font-medium inline-flex items-center gap-1">
            <StoreIcon size={11} /> שיוך לחנות
          </label>
          <NativeSelect
            value={scopedStore}
            onChange={e => setScopedStore(e.target.value)}
            className="text-xs h-auto py-1"
          >
            <option value="">כל החנויות</option>
            {storeOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={commit}
          disabled={!title.trim()}
          size="sm"
          className="gap-1"
        >
          <Check size={13} />
          שמור
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          className="gap-1"
        >
          <X size={13} />
          ביטול
        </Button>
        <span className="text-[10px] text-ink-muted ms-auto inline-flex items-center gap-1">
          <Calendar size={10} />
          יסומן על הגרף
        </span>
      </div>
    </div>
  );
}
