'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RichEditor } from '@/components/rich-editor';


// ─── Types ───────────────────────────────────────────────────────────────────

type Article = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  content_type: string;
  body: string | null;
  excerpt: string | null;
  semantic_tags: string[];
  associated_offers: string[];
  target_segments: string[];
  featured_image_url: string | null;
  status: 'draft' | 'published' | 'archived';
  created_by: string;
  author_name: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  view_count: number;
  engagement_score: number;
  seo_meta: {
    id: string;
    title: string | null;
    description: string | null;
    target_keyword: string | null;
    secondary_keywords: string[];
    keyword_cluster: string | null;
  } | null;
};

const DIGITAL_HOME_URL = process.env.NEXT_PUBLIC_DIGITAL_HOME_URL || '';

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-minimal-muted',
  published: 'bg-green-500',
  archived: 'bg-zinc-600',
};

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ArticleEditorPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info'; link?: string; exiting?: boolean } | null>(null);

  // Edit state
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editExcerpt, setEditExcerpt] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editSeoTitle, setEditSeoTitle] = useState('');
  const [editSeoDescription, setEditSeoDescription] = useState('');
  const [editSeoKeyword, setEditSeoKeyword] = useState('');

  const fetchArticle = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/articles/${slug}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setArticle(data);
    setLoading(false);
  }, [slug]);

  useEffect(() => { fetchArticle(); }, [fetchArticle]);

  const startEditing = () => {
    if (!article) return;
    setEditTitle(article.title);
    setEditBody(article.body || '');
    setEditExcerpt(article.excerpt || '');
    setEditTags(article.semantic_tags.join(', '));
    setEditSeoTitle(article.seo_meta?.title || '');
    setEditSeoDescription(article.seo_meta?.description || '');
    setEditSeoKeyword(article.seo_meta?.target_keyword || '');
    setShowMeta(false);
    setEditing(true);
  };

  const saveChanges = async () => {
    if (!article) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      title: editTitle,
      body: editBody,
      excerpt: editExcerpt,
      semantic_tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
    };
    if (article.seo_meta) {
      payload.seo = {
        title: editSeoTitle,
        description: editSeoDescription,
        target_keyword: editSeoKeyword,
      };
    }
    const res = await fetch(`/api/articles/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const updated = await res.json();
      setArticle(updated);
      setEditing(false);
    } else {
      const data = await res.json();
      alert(data.error || 'Save failed');
    }
    setSaving(false);
  };

  const showToast = (message: string, type: 'success' | 'info', link?: string) => {
    setToast({ message, type, link });
    setTimeout(() => {
      setToast((prev) => prev ? { ...prev, exiting: true } : null);
      setTimeout(() => setToast(null), 300);
    }, 4000);
  };

  const updateStatus = async (newStatus: 'draft' | 'published' | 'archived') => {
    if (!article) return;
    setShowMeta(false);
    setEditing(false);
    const res = await fetch(`/api/articles/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const updated = await res.json();
      setArticle(updated);
      if (newStatus === 'published') {
        showToast(
          'Article published — now live on your Digital Home',
          'success',
          `${DIGITAL_HOME_URL}/blog/${slug}`
        );
      } else if (newStatus === 'draft') {
        showToast('Article moved to draft', 'info');
      } else if (newStatus === 'archived') {
        showToast('Article archived', 'info');
      }
    }
  };

  const wordCount = (body: string | null) => {
    if (!body) return 0;
    return body.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-minimal-muted text-sm">Loading...</div>;
  }

  if (!article) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-minimal-muted text-sm">Article not found</p>
        <button onClick={() => router.back()} className="text-xs text-minimal-muted hover:text-white transition-colors">
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Toast notification */}
      {toast && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 ${toast.exiting ? 'toast-exit' : 'toast-enter'}`}>
          <div className={`px-6 py-3 rounded-lg border flex items-center gap-4 ${
            toast.type === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-minimal-border bg-minimal-row text-minimal-muted'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${toast.type === 'success' ? 'bg-green-500' : 'bg-minimal-muted'}`} />
            <span className="text-xs font-medium">{toast.message}</span>
            {toast.link && (
              <a
                href={toast.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-white hover:text-green-300 transition-colors"
              >
                View →
              </a>
            )}
          </div>
        </div>
      )}

      {/* Header — clean nav bar */}
      <header className="h-14 px-12 flex items-center justify-between border-b border-minimal-border shrink-0">
        {/* Left: back + status */}
        <div className="flex items-center gap-6">
          <button onClick={() => router.back()} className="text-minimal-muted hover:text-white transition-colors flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256">
              <path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z" />
            </svg>
            <span className="text-xs font-medium">Back</span>
          </button>
          <div className="h-4 w-px bg-minimal-border" />
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[article.status]}`} />
            <span className="text-xs font-medium capitalize text-minimal-muted">
              {article.status}
            </span>
          </div>
          {article.published_at && (
            <>
              <div className="h-4 w-px bg-minimal-border" />
              <span className="text-xs text-minimal-muted">
                {new Date(article.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-5">
          {!editing ? (
            <>
              <button
                onClick={() => setShowMeta(!showMeta)}
                className={`text-[13px] font-medium transition-colors ${showMeta ? 'text-white' : 'text-minimal-muted hover:text-white'}`}
              >
                Meta
              </button>
              <button
                onClick={startEditing}
                className="text-[13px] font-medium text-minimal-muted hover:text-white transition-colors"
              >
                Edit
              </button>
              {article.status === 'published' && (
                <button
                  onClick={() => updateStatus('draft')}
                  className="text-[13px] font-medium text-yellow-500 hover:text-yellow-400 transition-colors"
                >
                  Unpublish
                </button>
              )}
              {article.status === 'draft' && (
                <button
                  onClick={() => updateStatus('published')}
                  className="text-[13px] font-medium bg-white text-black px-4 py-1.5 rounded-lg"
                >
                  Publish
                </button>
              )}
              {article.status === 'published' && (
                <a
                  href={`${DIGITAL_HOME_URL}/blog/${article.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium border border-minimal-border text-white px-4 py-1.5 rounded-lg hover:border-minimal-muted transition-colors"
                >
                  View Site →
                </a>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(false)}
                className="text-[13px] font-medium text-minimal-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveChanges}
                disabled={saving}
                className="text-[13px] font-medium bg-white text-black px-4 py-1.5 rounded-lg disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto fade-in">
        <div className="flex">
          {/* Editor Area */}
          <div className={`flex-1 ${showMeta ? '' : ''}`}>
            <div className="max-w-[720px] mx-auto py-24 px-6">
              {/* Title */}
              {editing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-transparent text-4xl font-light tracking-tight mb-16 focus:outline-none placeholder:text-minimal-muted/30"
                />
              ) : (
                <h1 className="text-4xl font-light tracking-tight mb-16">
                  {article.title}
                </h1>
              )}

              {/* Body */}
              {article.body || editing ? (
                <RichEditor
                  content={editing ? editBody : (article.body || '')}
                  onChange={(html) => setEditBody(html)}
                  editable={editing}
                />
              ) : (
                <p className="text-minimal-muted/40 italic">No content body yet.</p>
              )}
            </div>
          </div>

          {/* Metadata Panel */}
          {showMeta && (
            <div className="w-80 shrink-0 border-l border-minimal-border p-8 overflow-y-auto">
              <div className="flex flex-col gap-6">
                <MetaSection title="Info">
                  <MetaRow label="Slug" value={article.slug} />
                  <MetaRow label="Type" value={article.content_type} />
                  <MetaRow label="Author" value={article.author_name} />
                  <MetaRow label="Source" value={article.created_by === 'content_agent' ? 'Agent' : 'Human'} />
                  <MetaRow label="Words" value={wordCount(article.body).toLocaleString()} />
                </MetaSection>

                <MetaSection title="Excerpt">
                  {editing ? (
                    <textarea
                      value={editExcerpt}
                      onChange={(e) => setEditExcerpt(e.target.value)}
                      rows={3}
                      className="w-full bg-transparent border border-minimal-border p-2 text-xs text-zinc-300 resize-none focus:outline-none focus:border-minimal-muted"
                    />
                  ) : (
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      {article.excerpt || 'No excerpt'}
                    </p>
                  )}
                </MetaSection>

                <MetaSection title="Tags">
                  {editing ? (
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="tag1, tag2"
                      className="w-full bg-transparent border border-minimal-border p-2 text-xs text-zinc-300 focus:outline-none focus:border-minimal-muted"
                    />
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      {article.semantic_tags.length > 0 ? (
                        article.semantic_tags.map((tag) => (
                          <span key={tag} className="text-xs text-zinc-400 border border-minimal-border px-2.5 py-1">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-minimal-muted/40">No tags</span>
                      )}
                    </div>
                  )}
                </MetaSection>

                {article.seo_meta && (
                  <MetaSection title="SEO">
                    {editing ? (
                      <div className="flex flex-col gap-3">
                        <label className="text-xs text-minimal-muted">
                          Title
                          <input
                            type="text"
                            value={editSeoTitle}
                            onChange={(e) => setEditSeoTitle(e.target.value)}
                            className="w-full bg-transparent border border-minimal-border p-2 mt-1 text-xs text-zinc-300 focus:outline-none focus:border-minimal-muted"
                          />
                        </label>
                        <label className="text-xs text-minimal-muted">
                          Description
                          <textarea
                            value={editSeoDescription}
                            onChange={(e) => setEditSeoDescription(e.target.value)}
                            rows={2}
                            className="w-full bg-transparent border border-minimal-border p-2 mt-1 text-xs text-zinc-300 resize-none focus:outline-none focus:border-minimal-muted"
                          />
                        </label>
                        <label className="text-xs text-minimal-muted">
                          Keyword
                          <input
                            type="text"
                            value={editSeoKeyword}
                            onChange={(e) => setEditSeoKeyword(e.target.value)}
                            className="w-full bg-transparent border border-minimal-border p-2 mt-1 text-xs text-zinc-300 focus:outline-none focus:border-minimal-muted"
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        <MetaRow label="Title" value={article.seo_meta.title || '—'} />
                        <MetaRow label="Desc" value={article.seo_meta.description || '—'} />
                        <MetaRow label="Keyword" value={article.seo_meta.target_keyword || '—'} />
                      </>
                    )}
                  </MetaSection>
                )}

                <MetaSection title="Performance">
                  <MetaRow label="Views" value={article.view_count.toLocaleString()} />
                  <MetaRow label="Score" value={article.engagement_score.toFixed(1)} />
                </MetaSection>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="h-16 px-12 flex items-center justify-between text-xs text-minimal-muted border-t border-minimal-border shrink-0">
        <div className="flex gap-8">
          <span>{editing ? 'Editing' : 'Preview'}</span>
          <span>Words: {wordCount(editing ? editBody : article.body)}</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function MetaSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-minimal-border pb-5 mb-1">
      <h3 className="text-xs font-medium text-minimal-muted mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <span className="text-xs text-minimal-muted block mb-1">{label}</span>
      <span className="text-sm text-zinc-300 block break-words">{value}</span>
    </div>
  );
}
