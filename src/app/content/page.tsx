'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { WritingGlow } from '@/components/ui/writing-glow';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';

// ─── Types ───────────────────────────────────────────────────────────────────

type CalendarEntry = {
  id: string;
  title: string;
  search_query: string | null;
  target_keyword: string | null;
  keyword_cluster: string | null;
  intent_type: string;
  priority: 'high' | 'medium' | 'low';
  status: 'planned' | 'approved' | 'writing' | 'draft' | 'published' | 'archived';
  pillar_topic: string | null;
  scheduled_publish_date: string | null;
  content_object_id: string | null;
  run_id: string | null;
  created_by: string;
  notes: string | null;
  created_at: string;
  content_objects: { slug: string; status: string; published_at: string | null } | null;
};

type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: 'draft' | 'published' | 'archived';
  created_by: string;
  author_name: string;
  published_at: string | null;
  created_at: string;
  body: string | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const BOARD_COLUMNS = ['planned', 'approved', 'writing', 'draft', 'published', 'archived'] as const;

const STATUS_DOT_COLORS: Record<string, string> = {
  planned: 'bg-minimal-muted',
  approved: 'bg-violet-400',
  writing: 'bg-yellow-500',
  draft: 'bg-minimal-muted',
  published: 'bg-green-500',
  archived: 'bg-zinc-600',
};

const PRIORITY_DOTS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-minimal-muted',
};


// Valid drag-and-drop transitions
const VALID_MOVES: Record<string, string[]> = {
  planned: ['approved', 'archived'],
  approved: ['planned', 'writing', 'archived'],
  writing: [],  // Only the agent moves things out of writing
  draft: ['published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['planned'],
};

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ContentPipelinePage() {
  const [view, setView] = useState<'board' | 'list'>('board');
  const [showModal, setShowModal] = useState(false);
  const [publishMode, setPublishMode] = useState<'safe' | 'autonomous'>('safe');
  const [digitalHomeUrl, setDigitalHomeUrl] = useState('');

  // Load settings from database on mount
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        const mode = data.settings?.publish_mode;
        if (mode === 'safe' || mode === 'autonomous') {
          setPublishMode(mode);
        }
        if (data.digital_home_url) {
          setDigitalHomeUrl(data.digital_home_url);
        }
      })
      .catch(() => {});
  }, []);

  const saveMode = async (mode: 'safe' | 'autonomous') => {
    setPublishMode(mode);
    // Save to database so backend automation routes can read it
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'publish_mode', value: mode }),
      });
    } catch {
      // Fallback: still works locally even if DB save fails
    }
  };

  const handleModeToggle = () => {
    if (publishMode === 'safe') {
      // Switching to autonomous — show confirmation
      setShowModal(true);
    } else {
      // Switching to safe — no confirmation needed
      saveMode('safe');
    }
  };

  const confirmAutonomous = () => {
    saveMode('autonomous');
    setShowModal(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="h-20 px-12 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-white">
          {view === 'board' ? 'Pipeline' : 'Articles'}
        </h1>
        <div className="flex items-center gap-6">
          <button
            onClick={() => setView('board')}
            className={`text-[13px] font-medium transition-colors ${
              view === 'board' ? 'text-white' : 'text-minimal-muted hover:text-white'
            }`}
          >
            Pipeline
          </button>
          <button
            onClick={() => setView('list')}
            className={`text-[13px] font-medium transition-colors ${
              view === 'list' ? 'text-white' : 'text-minimal-muted hover:text-white'
            }`}
          >
            Articles
          </button>
        </div>
      </header>

      {/* Mode Bar */}
      <div className={`mx-12 mb-6 px-6 py-4 border rounded shrink-0 flex items-center justify-between transition-colors ${
        publishMode === 'autonomous'
          ? 'border-green-500/20 bg-green-500/5'
          : 'border-minimal-border bg-minimal-row'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${
            publishMode === 'autonomous' ? 'bg-green-500' : 'bg-minimal-muted'
          }`} />
          <div>
            <span className={`text-xs font-medium ${
              publishMode === 'autonomous' ? 'text-green-500' : 'text-white'
            }`}>
              {publishMode === 'autonomous' ? 'Autonomous' : 'Safe Mode'}
            </span>
            <p className="text-xs text-minimal-muted mt-0.5">
              {publishMode === 'autonomous'
                ? 'AI approves topics and publishes articles automatically'
                : 'Articles require manual review before publishing'}
            </p>
          </div>
        </div>
        <button
          onClick={handleModeToggle}
          className={`text-xs font-medium px-4 py-2 border rounded-lg transition-colors ${
            publishMode === 'autonomous'
              ? 'border-green-500/30 text-green-500 hover:bg-green-500/10'
              : 'border-minimal-border text-minimal-muted hover:text-white hover:border-minimal-muted'
          }`}
        >
          {publishMode === 'autonomous' ? 'Switch to Safe' : 'Enable Autonomous'}
        </button>
      </div>

      {view === 'board' ? <BoardView digitalHomeUrl={digitalHomeUrl} /> : <ListView />}

      {/* Footer */}
      <footer className="h-16 px-12 flex items-center justify-end text-xs text-minimal-muted shrink-0">
        <span>Digital Home / {view === 'board' ? 'Pipeline' : 'Articles'}</span>
      </footer>

      {/* Autonomous Mode Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setShowModal(false)}
          />
          {/* Modal */}
          <div className="relative w-full max-w-md border border-minimal-border bg-minimal-bg p-10">
            <h2 className="text-base font-semibold text-white mb-8">
              Switch to Autonomous Mode?
            </h2>

            <div className="flex flex-col gap-5 mb-10">
              <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0" />
                <p className="text-sm text-zinc-400 leading-relaxed">
                  New topics from content strategy will be <span className="text-white">auto-approved</span> — skipping the Planned stage entirely
                </p>
              </div>
              <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0" />
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Articles will be <span className="text-white">published directly</span> — no draft review step
                </p>
              </div>
              <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-minimal-muted mt-1.5 shrink-0" />
                <p className="text-sm text-zinc-400 leading-relaxed">
                  You can still edit or unpublish any article after the fact
                </p>
              </div>
              <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-minimal-muted mt-1.5 shrink-0" />
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Switch back to Safe Mode at any time
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-4">
              <button
                onClick={() => setShowModal(false)}
                className="text-[13px] font-semibold text-zinc-300 hover:text-white transition-colors px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmAutonomous}
                className="text-xs font-medium bg-white text-black px-6 py-2.5 rounded-lg"
              >
                Enable Autonomous
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Board View (Kanban) ─────────────────────────────────────────────────────

function BoardView({ digitalHomeUrl }: { digitalHomeUrl: string }) {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Silent refresh — no loading spinner after initial load
  const fetchEntries = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const res = await fetch('/api/content-calendar?limit=200', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to load calendar');
      }

      const data = await res.json();
      setEntries((data.entries || []) as CalendarEntry[]);
    } catch (error) {
      console.error(error);
      setEntries([]);
    }
    if (showLoader) setLoading(false);
  }, []);

  // Only show loading spinner on first load
  useEffect(() => { fetchEntries(true); }, [fetchEntries]);

  // Optimistic status update — move card instantly, sync with DB in background
  const updateStatus = async (id: string, status: CalendarEntry['status']) => {
    // Optimistic: update locally first
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status } : e))
    );
    // Then sync with database
    const res = await fetch(`/api/content-calendar/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      fetchEntries();
      return;
    }
    // Silent refresh to pick up any server-side changes
    fetchEntries();
  };

  const publishEntry = async (id: string) => {
    setPublishing(id);
    // Optimistic: move to published immediately
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: 'published' as const } : e))
    );
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ calendar_entry_id: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Publish failed');
        fetchEntries(); // Revert on failure
        return;
      }
      fetchEntries(); // Silent refresh
    } finally { setPublishing(null); }
  };

  const resetStuck = async (id?: string) => {
    try {
      await fetch('/api/reset-writing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(id ? { calendar_entry_id: id } : {}),
      });
      fetchEntries();
    } catch {
      // Silent fail — fetchEntries will still refresh
      fetchEntries();
    }
  };

  const writeNow = async (id: string) => {
    setWriting(id);
    // Optimistic: move to writing immediately
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: 'writing' as const } : e))
    );
    try {
      const res = await fetch('/api/write-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ calendar_entry_id: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Write failed');
        fetchEntries(); // Revert on failure
        setWriting(null);
        return;
      }
      fetchEntries(); // Silent refresh to pick up the new article
    } catch (err) {
      alert('Write failed — check console for details');
      console.error(err);
      fetchEntries(); // Revert
    } finally { setWriting(null); }
  };

  // ─── Drag handlers ───
  const activeEntry = entries.find((e) => e.id === activeId);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverColumn(event.over?.id as string || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverColumn(null);

    if (!over) return;

    const entry = entries.find((e) => e.id === active.id);
    const targetStatus = over.id as string;

    if (!entry || entry.status === targetStatus) return;

    const allowed = VALID_MOVES[entry.status] || [];
    if (!allowed.includes(targetStatus)) return;

    // Handle special transitions
    if (targetStatus === 'writing') {
      // Dragging to Writing triggers AI write
      writeNow(entry.id);
    } else if (targetStatus === 'published' && entry.status === 'draft') {
      publishEntry(entry.id);
    } else {
      updateStatus(entry.id, targetStatus as CalendarEntry['status']);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverColumn(null);
  };

  const grouped = BOARD_COLUMNS.reduce((acc, status) => {
    const items = entries.filter((e) => e.status === status);
    if (status === 'published') {
      items.sort((a, b) => {
        const aTime = a.content_objects?.published_at || a.created_at;
        const bTime = b.content_objects?.published_at || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
    }
    acc[status] = items;
    return acc;
  }, {} as Record<string, CalendarEntry[]>);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-minimal-muted text-sm">Loading...</div>;
  }

  const activeEntryStatus = activeEntry?.status || '';
  const validTargets = VALID_MOVES[activeEntryStatus] || [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex-1 px-12 pb-6 overflow-x-auto flex gap-6">
        {BOARD_COLUMNS.map((status) => (
          <DroppableColumn
            key={status}
            id={status}
            count={grouped[status].length}
            isOver={overColumn === status}
            isValid={activeId ? validTargets.includes(status) : false}
            isDragging={!!activeId}
          >
            {grouped[status].length === 0 ? (
              <div className="text-xs text-minimal-muted/40 text-center py-8">
                {activeId && validTargets.includes(status) ? 'Drop here' : 'Empty'}
              </div>
            ) : (
              grouped[status].map((entry) => (
                <DraggableCard
                  key={entry.id}
                  entry={entry}
                  isDragging={activeId === entry.id}
                  writing={writing}
                  publishing={publishing}
                  onApprove={() => updateStatus(entry.id, 'approved')}
                  onWriteNow={() => writeNow(entry.id)}
                  onPublish={() => publishEntry(entry.id)}
                  onReset={() => resetStuck(entry.id)}
                  digitalHomeUrl={digitalHomeUrl}
                />
              ))
            )}
          </DroppableColumn>
        ))}
      </div>

      {/* Drag overlay — the ghost card that follows the cursor */}
      <DragOverlay>
        {activeEntry ? (
          <div className="border border-minimal-muted p-5 bg-minimal-row/95 backdrop-blur-sm w-72 shadow-2xl">
            <p className="text-[14px] leading-relaxed font-light">{activeEntry.title}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Droppable Column ─────────────────────────────────────────────────────────

function DroppableColumn({
  id,
  count,
  isOver,
  isValid,
  isDragging,
  children,
}: {
  id: string;
  count: number;
  isOver: boolean;
  isValid: boolean;
  isDragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });

  let columnClass = 'border-transparent';
  if (isDragging && isOver && isValid) columnClass = 'drop-target-valid';
  else if (isDragging && isOver && !isValid) columnClass = 'drop-target-invalid';
  else if (isDragging && isValid) columnClass = 'border-minimal-border/50';

  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 flex flex-col gap-4 border rounded-lg p-2 -m-2 transition-colors ${columnClass}`}
    >
      <div className="flex items-center justify-between border-b border-minimal-border pb-3 px-1">
        <span className="text-xs font-medium capitalize text-minimal-muted">
          {id}
        </span>
        <span className="text-xs text-minimal-muted">{count}</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto flex-1 px-3 -mx-3">
        {children}
      </div>
    </div>
  );
}

// ─── Draggable Card ───────────────────────────────────────────────────────────

function DraggableCard({
  entry,
  isDragging,
  writing,
  publishing,
  onApprove,
  onWriteNow,
  onPublish,
  onReset,
  digitalHomeUrl,
}: {
  entry: CalendarEntry;
  isDragging: boolean;
  writing: string | null;
  publishing: string | null;
  onApprove: () => void;
  onWriteNow: () => void;
  onPublish: () => void;
  onReset: () => void;
  digitalHomeUrl: string;
}) {
  const canDrag = (VALID_MOVES[entry.status] || []).length > 0 && entry.status !== 'writing';
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: entry.id,
    disabled: !canDrag,
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const isWriting = entry.status === 'writing' || writing === entry.id;
  const isBeingWritten = writing === entry.id;
  const isNew = isRecentlyPublished(entry);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
      className={`group relative border rounded-lg p-5 transition-colors bg-minimal-row ${
        isDragging ? 'dragging-card' : ''
      } ${
        isNew ? 'border-green-500/30' : isWriting ? 'border-transparent' : 'border-minimal-border hover:border-minimal-muted'
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
    >
      {isWriting && <WritingGlow />}
      {/* NEW badge for recently published articles */}
      {isNew && (
        <span className="absolute top-3 right-3 text-xs font-semibold text-green-500 bg-green-500/10 px-2 py-0.5 rounded-lg">
          New
        </span>
      )}
      {/* Title — clickable link to editor if article exists */}
      {entry.content_objects?.slug ? (
        <Link href={`/content/${entry.content_objects.slug}`} className="block">
          <p className="text-[14px] leading-relaxed mb-3 font-light hover:text-white transition-colors underline-offset-4 hover:underline">
            {entry.title}
          </p>
        </Link>
      ) : (
        <p className="text-[14px] leading-relaxed mb-3 font-light">
          {entry.title}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-3 mb-1">
        {entry.priority && (
          <div className={`w-1.5 h-1.5 rounded-full ${entry.status === 'published' ? STATUS_DOT_COLORS.published : PRIORITY_DOTS[entry.priority]}`} title={entry.status === 'published' ? 'published' : entry.priority} />
        )}
        {entry.target_keyword ? (
          <span className="text-xs text-minimal-muted">
            {entry.target_keyword}
          </span>
        ) : (
          <span className="text-xs text-minimal-muted">
            {timeAgo(entry.created_at)}
          </span>
        )}
      </div>

      {/* Always-visible writing indicator + reset escape hatch */}
      {isWriting && (
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-500">
              {isBeingWritten ? 'Writing with AI...' : 'Agent writing...'}
            </span>
          </div>
          {/* Only show Reset when not actively being written (i.e. it's stuck) */}
          {!isBeingWritten && (
            <button
              onClick={(e) => { e.stopPropagation(); onReset(); }}
              className="text-xs text-minimal-muted hover:text-red-400 transition-colors"
              title="Reset stuck article back to Approved"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Actions — always visible for draft/published, hover for planned/approved */}
      {!isWriting && (
        <div className={`flex gap-2 mt-3 transition-opacity ${
          entry.status === 'draft' || entry.status === 'published'
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        }`}>
          {entry.status === 'planned' && (
            <button
              onClick={(e) => { e.stopPropagation(); onApprove(); }}
              className="text-xs text-minimal-muted hover:text-white transition-colors"
            >
              Approve
            </button>
          )}
          {entry.status === 'approved' && (
            <button
              onClick={(e) => { e.stopPropagation(); onWriteNow(); }}
              disabled={!!writing}
              className="text-xs text-white hover:text-green-400 transition-colors disabled:opacity-40"
            >
              Write Now
            </button>
          )}
          {entry.status === 'draft' && (
            <>
              {entry.content_objects?.slug && (
                <Link
                  href={`/content/${entry.content_objects.slug}`}
                  className="text-xs text-minimal-muted hover:text-white transition-colors"
                >
                  Preview
                </Link>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onPublish(); }}
                disabled={publishing === entry.id}
                className="text-xs text-green-500 hover:text-green-400 transition-colors disabled:opacity-40"
              >
                {publishing === entry.id ? 'Publishing...' : 'Publish'}
              </button>
            </>
          )}
          {entry.status === 'published' && entry.content_objects?.slug && (
            <>
              <Link
                href={`/content/${entry.content_objects.slug}`}
                className="text-xs text-minimal-muted hover:text-white transition-colors"
              >
                Edit
              </Link>
              <a
                href={`${digitalHomeUrl}/blog/${entry.content_objects.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="text-xs text-green-500 hover:text-green-400 transition-colors"
              >
                View →
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

function ListView() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/articles');
    const data = await res.json();
    setArticles(data.articles || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-minimal-muted text-sm">Loading...</div>;
  }

  return (
    <div className="flex-1 px-12 py-4 overflow-y-auto">
      <div className="max-w-[800px] mx-auto">
        {articles.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-2xl mb-4 opacity-10">◇</div>
            <p className="text-minimal-muted text-sm mb-2">No articles yet.</p>
            <p className="text-minimal-muted/60 text-xs">
              Articles appear once the content agent writes them.
            </p>
          </div>
        ) : (
          <div className="flex flex-col border-t border-minimal-border">
            {articles.map((article) => (
              <Link
                key={article.id}
                href={`/content/${article.slug}`}
                className="group flex items-center py-6 border-b border-minimal-border transition-colors hover:bg-minimal-row px-4 -mx-4"
              >
                <div className="flex-1">
                  <span className="text-[15px] font-normal tracking-tight">
                    {article.title}
                  </span>
                </div>
                <div className="w-32 flex justify-end">
                  <span className="text-xs font-medium capitalize text-minimal-muted group-hover:text-minimal-accent transition-colors">
                    {article.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecentlyPublished(entry: CalendarEntry): boolean {
  if (entry.status !== 'published') return false;
  const publishedAt = entry.content_objects?.published_at;
  if (!publishedAt) return false;
  const tenMinutes = 10 * 60 * 1000;
  return Date.now() - new Date(publishedAt).getTime() < tenMinutes;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
