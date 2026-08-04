import React, { useState, useEffect, useRef } from 'react';
import renderMarkdown from '../utils/markdown';
import '../utils/markdown.css';

// Unique ID Generator
const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

/** The owl glyph, shared by the launcher, the header and every assistant message. */
function OwlMark({ size = 18 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: 'block' }}
    >
      <path d="M12 2.5C6.9 2.5 4.5 4.8 4.5 8c0 4.2 2.9 10.2 7.5 12.5 4.6-2.3 7.5-8.3 7.5-12.5 0-3.2-2.4-5.5-7.5-5.5z" />
      <circle cx="9.2" cy="9" r="2.3" />
      <circle cx="14.8" cy="9" r="2.3" />
      <circle cx="9.2" cy="9" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="9" r="0.75" fill="currentColor" stroke="none" />
      <path d="M12 11.6l-1.2 2 1.2.8 1.2-.8-1.2-2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function OwlSpeaksChat({ symbols = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [message, setMessage] = useState('');
  const [attachedImages, setAttachedImages] = useState([]); // Base64 data URIs
  const [isLoading, setIsLoading] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);

  // Draggable and Resizable window state
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e) => {
    // Only drag with primary pointer (left click / touch)
    if (e.button !== 0 && e.button !== -1) return;
    // Don't drag if clicking buttons, inputs, selects, or textareas
    if (
      e.target.closest('button') || 
      e.target.closest('select') || 
      e.target.closest('input') || 
      e.target.closest('textarea')
    ) return;
    
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
    e.preventDefault();
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragStart.current.x;
      const newY = e.clientY - dragStart.current.y;
      
      // Constrain within viewport with a 10px margin
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const chatWidth = isExpanded ? 750 : 440;
      const chatHeight = isExpanded ? 700 : 580;
      const leftEdge = vw - 24 - chatWidth;
      const topEdge = vh - 96 - chatHeight;
      const margin = 10;
      
      const constrainedX = Math.max(-(leftEdge - margin), Math.min(vw - leftEdge - chatWidth - margin, newX));
      const constrainedY = Math.max(-(topEdge - margin), Math.min(vh - topEdge - chatHeight - margin, newY));

      setPosition({ x: constrainedX, y: constrainedY });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, isExpanded]);

  // Keep window in bounds when size changes
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const chatWidth = isExpanded ? 750 : 440;
    const chatHeight = isExpanded ? 700 : 580;
    const leftEdge = vw - 24 - chatWidth;
    const topEdge = vh - 96 - chatHeight;
    const margin = 10;

    const minX = -(leftEdge - margin);
    const maxX = vw - leftEdge - chatWidth - margin;
    const minY = -(topEdge - margin);
    const maxY = vh - topEdge - chatHeight - margin;

    setPosition((prev) => ({
      x: Math.max(minX, Math.min(maxX, prev.x)),
      y: Math.max(minY, Math.min(maxY, prev.y))
    }));
  }, [isExpanded]);

  // localStorage thread model: { id, title, messages: [], symbol, timestamp }
  const [threads, setThreads] = useState(() => {
    const saved = localStorage.getItem('owl_speaks_threads');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        console.error('Failed to load chat threads:', e);
      }
    }
    // Initialize default thread
    const defaultId = generateId();
    return [
      {
        id: defaultId,
        title: 'New Analysis',
        symbol: '',
        timestamp: Date.now(),
        messages: [
          {
            role: 'assistant',
            content: 'Hello! I am **Owl Speaks**, your local financial intelligence assistant.\n\nYou can ask me general trading questions, or select a context asset from the dropdown above to automatically analyze its real-time technical indicators (RSI, Moving Averages, MACD) and triggering logs.\n\n**Multimodal Vision is enabled!** You can click the paperclip icon or paste a chart screenshot directly from your clipboard to analyze charts together.\n\nHow can I help you today?',
          },
        ],
      },
    ];
  });

  const [activeThreadId, setActiveThreadId] = useState(() => {
    const savedActive = localStorage.getItem('owl_speaks_active_thread_id');
    if (savedActive) return savedActive;
    return threads[0]?.id || null;
  });

  const activeThread = threads.find((t) => t.id === activeThreadId) || threads[0];
  const chatHistory = activeThread?.messages || [];
  const selectedSymbol = activeThread?.symbol || '';

  const historyEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Sync threads to localStorage
  useEffect(() => {
    localStorage.setItem('owl_speaks_threads', JSON.stringify(threads));
  }, [threads]);

  // Sync activeThreadId to localStorage
  useEffect(() => {
    if (activeThreadId) {
      localStorage.setItem('owl_speaks_active_thread_id', activeThreadId);
    }
  }, [activeThreadId]);

  // Toggle chat widget on Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scroll to bottom on new messages or loading states
  useEffect(() => {
    if (historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isLoading, isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 100);
    }
  }, [isOpen]);

  const handleImageFiles = (files) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachedImages((prev) => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items || [];
    const imageItems = Array.from(items).filter((item) => item.type.indexOf('image') !== -1);
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map((item) => item.getAsFile());
      handleImageFiles(files);
    }
  };

  // `presetText` lets the starter prompts send in one click instead of only filling the box.
  const handleSend = async (e, presetText) => {
    if (e) e.preventDefault();
    const outgoing = presetText ?? message;
    if ((!outgoing.trim() && attachedImages.length === 0) || isLoading) return;

    const userMsg = outgoing;
    const currentImages = [...attachedImages];
    setMessage('');
    setAttachedImages([]);

    // 1. Update local state history
    const newUserMessage = {
      role: 'user',
      content: userMsg,
      images: currentImages, // Store complete data URI for local view
    };

    const updatedMessages = [...chatHistory, newUserMessage];

    // Auto-update thread title on the first real query
    let newTitle = activeThread.title;
    if (newTitle === 'New Analysis' && userMsg.trim()) {
      newTitle = userMsg.length > 25 ? userMsg.substring(0, 25) + '...' : userMsg;
    }

    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThreadId
          ? { ...t, title: newTitle, messages: updatedMessages, timestamp: Date.now() }
          : t
      )
    );

    setIsLoading(true);

    try {
      // 2. Prepare payload for Ollama backend (strip header metadata from base64 strings)
      const cleanedBase64Images = currentImages.map((img) => img.split(',')[1]);

      const payload = {
        message: userMsg,
        symbol: selectedSymbol || null,
        history: updatedMessages.slice(1, -1).map((h) => ({
          role: h.role,
          content: h.content,
        })),
        images: cleanedBase64Images.length > 0 ? cleanedBase64Images : null,
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          setThreads((prev) =>
            prev.map((t) =>
              t.id === activeThreadId
                ? {
                    ...t,
                    messages: [...updatedMessages, { role: 'assistant', content: data.response }],
                  }
                : t
            )
          );
        } else {
          setThreads((prev) =>
            prev.map((t) =>
              t.id === activeThreadId
                ? {
                    ...t,
                    messages: [
                      ...updatedMessages,
                      { role: 'assistant', content: `**Error:** ${data.detail || 'Failed'}` },
                    ],
                  }
                : t
            )
          );
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setThreads((prev) =>
          prev.map((t) =>
            t.id === activeThreadId
              ? {
                  ...t,
                  messages: [
                    ...updatedMessages,
                    {
                      role: 'assistant',
                      content: `**Error (${res.status}):** ${err.detail || 'Failed to connect. Make sure Pulse is running.'}`,
                    },
                  ],
                }
              : t
          )
        );
      }
    } catch (e) {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === activeThreadId
            ? {
                ...t,
                messages: [
                  ...updatedMessages,
                  {
                    role: 'assistant',
                    content: '**Connection Error:** View backend chat proxy is currently offline.',
                  },
                ],
              }
            : t
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const createNewThread = () => {
    const newId = generateId();
    const newThread = {
      id: newId,
      title: 'New Analysis',
      symbol: '',
      timestamp: Date.now(),
      messages: [
        {
          role: 'assistant',
          content: 'Hello! I am **Owl Speaks**, your local financial intelligence assistant. How can I help you analyze the markets?',
        },
      ],
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newId);
    setShowHistory(false);
  };

  const deleteThread = (threadId, e) => {
    e.stopPropagation();
    const filtered = threads.filter((t) => t.id !== threadId);
    if (filtered.length === 0) {
      const defaultId = generateId();
      const defaultThread = {
        id: defaultId,
        title: 'New Analysis',
        symbol: '',
        timestamp: Date.now(),
        messages: [
          {
            role: 'assistant',
            content: 'Hello! I am **Owl Speaks**, your local financial intelligence assistant. How can I help you analyze the markets?',
          },
        ],
      };
      setThreads([defaultThread]);
      setActiveThreadId(defaultId);
    } else {
      setThreads(filtered);
      if (activeThreadId === threadId) {
        setActiveThreadId(filtered[0].id);
      }
    }
  };

  const updateThreadSymbol = (sym) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === activeThreadId ? { ...t, symbol: sym } : t))
    );
  };

  const clearChatHistory = () => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThreadId
          ? {
              ...t,
              messages: [
                {
                  role: 'assistant',
                  content: 'Conversation history reset. How can I help you?',
                },
              ],
            }
          : t
      )
    );
  };

  const handleKeyDownInput = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatMessage = (text) => renderMarkdown(text);

  // Suggestions follow the attached context, so they are useful rather than decorative.
  const starterPrompts = selectedSymbol
    ? [
        `What is the technical setup for ${selectedSymbol}?`,
        `Is ${selectedSymbol} overbought or oversold right now?`,
        `Any recent news moving ${selectedSymbol}?`,
      ]
    : [
        'Explain RSI and how to read it',
        'What does a death cross signal?',
        'Compare ETFs with mutual funds',
      ];

  return (
    <>
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          style={styles.triggerButton}
          title="Owl Speaks Chat (Cmd + K)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 26, height: 26 }}>
            {/* Owl Ears / Head Outline */}
            <path d="M12 2C6.5 2 4 4.5 4 8c0 4.5 3 11 8 13.5 5-2.5 8-9 8-13.5 0-3.5-2.5-6-8-6z" />
            {/* Left Eye */}
            <circle cx="9" cy="9" r="2.5" />
            <circle cx="9" cy="9" r="0.8" fill="currentColor" />
            {/* Right Eye */}
            <circle cx="15" cy="9" r="2.5" />
            <circle cx="15" cy="9" r="0.8" fill="currentColor" />
            {/* Beak */}
            <path d="M12 11l-1.5 2.5 1.5 1 1.5-1-1.5-2.5z" fill="currentColor" />
            {/* Speech / Sound Wave indicators to represent "Speaks" */}
            <path d="M19 8c1.5 1 1.5 3 0 4M21 6c2.5 1.5 2.5 5.5 0 7" strokeWidth={1.5} />
          </svg>
        </button>
      )}

      {/* Floating Chat Container */}
      {isOpen && (
        <div
          style={{
            ...styles.chatOverlay,
            width: isExpanded ? 750 : 440,
            height: isExpanded ? 700 : 580,
            transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          }}
        >
          {/* Header */}
          <div
            onPointerDown={handlePointerDown}
            style={{
              ...styles.chatHeader,
              cursor: isDragging ? 'grabbing' : 'grab',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            {/* Row 1 — identity and window controls. Six controls previously shared one row,
                which is why the title, the context select and the actions all felt crammed. */}
            <div style={styles.headerTopRow}>
              <div style={styles.headerLeft}>
                <button
                  onClick={() => setShowHistory((prev) => !prev)}
                  style={{ ...styles.iconBtn, color: showHistory ? 'var(--accent-text)' : 'var(--text-secondary)' }}
                  title="Conversation history"
                >
                  <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ width: 17, height: 17 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                  </svg>
                </button>
                <div style={styles.avatar} aria-hidden="true">
                  <OwlMark size={17} />
                </div>
                <div style={styles.identity}>
                  <span style={styles.headerTitle}>Owl Speaks</span>
                  <span style={styles.headerSub}>
                    <span style={styles.statusDot} />
                    {selectedSymbol ? `Analysing ${selectedSymbol}` : 'Ready'}
                  </span>
                </div>
              </div>

              <div style={styles.headerActions}>
                <button
                  type="button"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  style={styles.iconBtnMuted}
                  title={isExpanded ? 'Collapse window' : 'Expand window'}
                >
                  {isExpanded ? (
                    <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ width: 15, height: 15 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9h6v6M9 15h6V9M15 15l-6-6M9 15l6-6" />
                    </svg>
                  ) : (
                    <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ width: 15, height: 15 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75h6.5m-6.5 0v6.5m0-6.5L10.5 10.5m9.75 9.75h-6.5m6.5 0v-6.5m0 6.5L13.5 13.5" />
                    </svg>
                  )}
                </button>
                <button onClick={() => setIsOpen(false)} style={styles.iconBtnMuted} title="Close">
                  <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Row 2 — conversation settings, which are a different kind of control. */}
            <div style={styles.headerBottomRow}>
              <select
                value={selectedSymbol}
                onChange={(e) => updateThreadSymbol(e.target.value)}
                style={styles.symbolSelector}
                title="Attach a symbol's live indicators to your questions"
              >
                <option value="">No context</option>
                {symbols.map((sym) => (
                  <option key={sym} value={sym}>
                    Context: {sym}
                  </option>
                ))}
              </select>
              <button onClick={clearChatHistory} style={styles.clearBtn} title="Clear this conversation">
                Clear
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>
            {/* Sliding History Drawer */}
            {showHistory && (
              <div style={styles.historyDrawer}>
                <div style={styles.drawerHeader}>
                  <span style={styles.drawerTitle}>Conversations</span>
                  <button onClick={createNewThread} style={styles.newThreadBtn}>
                    + New
                  </button>
                </div>
                <div style={styles.drawerList}>
                  {threads.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => {
                        setActiveThreadId(t.id);
                        setShowHistory(false);
                      }}
                      style={{
                        ...styles.drawerItem,
                        backgroundColor: t.id === activeThreadId ? 'var(--accent-soft)' : 'transparent',
                        borderColor: t.id === activeThreadId ? 'var(--accent)' : 'transparent',
                      }}
                    >
                      <span style={styles.drawerItemTitle}>{t.title}</span>
                      <button onClick={(e) => deleteThread(t.id, e)} style={styles.deleteThreadBtn} title="Delete">
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chat Body */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              {/* Message History */}
              <div style={styles.chatHistory}>
                {/* Anchors the conversation to the bottom so a short thread meets the
                    composer instead of leaving a large void beneath it. `margin-top: auto`
                    collapses once the thread overflows, so scrolling still behaves. */}
                <div style={{ marginTop: 'auto' }} />
                {chatHistory.map((msg, index) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div key={index} style={styles.messageRow(isUser)}>
                      {/* An avatar on the assistant side gives the answers an author. Without
                          it a reply was just a grey slab with nothing marking who spoke. */}
                      {!isUser && (
                        <div style={styles.msgAvatar} aria-hidden="true">
                          <OwlMark size={15} />
                        </div>
                      )}
                      <div
                        // md-on-accent re-points the markdown colours at the bubble's own text
                        // colour; on the accent fill the themed ones have no contrast.
                        className={isUser ? 'md-on-accent' : undefined}
                        style={{
                          ...styles.message,
                          ...(isUser ? styles.userMessage : styles.assistantMessage),
                        }}
                      >
                        {formatMessage(msg.content)}
                        {msg.images && msg.images.map((img, i) => (
                          <img key={i} src={img} alt="Attached upload" style={styles.messageImage} />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Starter prompts, shown while the conversation is still just the greeting.
                    This is what the empty panel was missing: it said nothing about what Owl
                    Speaks could be asked, and left most of the window blank. */}
                {chatHistory.length <= 1 && !isLoading && (
                  <div style={styles.starterWrap}>
                    <div style={styles.starterLabel}>Try asking</div>
                    {starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        style={styles.starterChip}
                        onClick={() => handleSend(null, prompt)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                          e.currentTarget.style.background = 'var(--accent-soft)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border)';
                          e.currentTarget.style.background = 'var(--bg-elevated)';
                        }}
                      >
                        {prompt}
                      </button>
                    ))}
                    <div style={styles.starterHint}>
                      Paste a chart screenshot into the box below and Owl Speaks will read it.
                    </div>
                  </div>
                )}

                {isLoading && (
                  <div style={styles.messageRow(false)}>
                    <div style={styles.msgAvatar} aria-hidden="true">
                      <OwlMark size={15} />
                    </div>
                    <div style={{ ...styles.message, ...styles.assistantMessage }}>
                      <div style={styles.loader}>
                        <span style={styles.loaderDot} />
                        <span style={{ ...styles.loaderDot, animationDelay: '0.16s' }} />
                        <span style={{ ...styles.loaderDot, animationDelay: '0.32s' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={historyEndRef} />
              </div>

              {/* Attachments Preview Area */}
              {attachedImages.length > 0 && (
                <div style={styles.previewContainer}>
                  {attachedImages.map((img, index) => (
                    <div key={index} style={styles.previewWrapper}>
                      <img src={img} alt="Attachment Preview" style={styles.previewImage} />
                      <button
                        onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== index))}
                        style={styles.previewRemoveBtn}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input Area */}
              <form onSubmit={handleSend} style={styles.inputArea}>
                {/* Attach and send sit inside one bordered field, so the composer reads as a
                    single control instead of three loose widgets on a bar. */}
                <div
                  style={{
                    ...styles.composer,
                    borderColor: composerFocused ? 'var(--accent)' : 'var(--border)',
                    boxShadow: composerFocused ? '0 0 0 3px var(--accent-soft)' : 'none',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={styles.attachButton}
                    title="Attach an image"
                  >
                    <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ width: 17, height: 17 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.5l-10.5 10.5a1.5 1.5 0 11-2.12-2.12l8.83-8.83m-6.02 6.02l-1.07-1.07" />
                    </svg>
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => handleImageFiles(e.target.files)}
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                  />

                  <textarea
                    ref={inputRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDownInput}
                    onPaste={handlePaste}
                    onFocus={() => setComposerFocused(true)}
                    onBlur={() => setComposerFocused(false)}
                    placeholder="Ask about a setup, or paste a chart…"
                    rows={1}
                    style={styles.inputField}
                  />

                  <button
                    type="submit"
                    disabled={isLoading || (!message.trim() && attachedImages.length === 0)}
                    style={{
                      ...styles.sendButton,
                      opacity: isLoading || (!message.trim() && attachedImages.length === 0) ? 0.45 : 1,
                      cursor: isLoading || (!message.trim() && attachedImages.length === 0) ? 'default' : 'pointer',
                    }}
                    title="Send (Enter)"
                  >
                    <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </button>
                </div>
                <div style={styles.composerHint}>
                  <kbd style={styles.kbd}>Enter</kbd> to send · <kbd style={styles.kbd}>Shift</kbd>+<kbd style={styles.kbd}>Enter</kbd> for a new line
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  triggerButton: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
    color: 'var(--accent-contrast)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-accent)',
    zIndex: 9998,
    transition: 'transform 0.2s',
    outline: 'none',
  },
  chatOverlay: {
    position: 'fixed',
    bottom: 96,
    right: 24,
    width: 440,
    height: 580,
    background: 'var(--bg-surface)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-overlay)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 9998,
  },
  chatHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '12px 14px',
    background: 'var(--bg-muted)',
    borderBottom: '1px solid var(--border)',
  },
  headerTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerBottomRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    minWidth: 0,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 9,
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  identity: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minWidth: 0,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    outline: 'none',
    padding: 4,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    transition: 'color 0.15s',
  },
  iconBtnMuted: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    outline: 'none',
    padding: 5,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s, background 0.15s',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--success)',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-primary)',
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  headerSub: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1.3,
  },
  symbolSelector: {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '5px 9px',
    fontSize: 11.5,
    fontWeight: 500,
    outline: 'none',
    cursor: 'pointer',
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  clearBtn: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    fontSize: 11.5,
    fontWeight: 500,
    cursor: 'pointer',
    outline: 'none',
    padding: '5px 4px',
    flexShrink: 0,
  },
  historyDrawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '60%',
    height: '100%',
    background: 'var(--bg-muted)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 9999,
    animation: 'react-slide-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
  },
  drawerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border-subtle)',
  },
  drawerTitle: {
    color: 'var(--text-primary)',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  newThreadBtn: {
    background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
    color: 'var(--accent-contrast)',
    border: 'none',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
  },
  drawerList: {
    flex: 1,
    overflowY: 'auto',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  drawerItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.2s',
  },
  drawerItemTitle: {
    color: 'var(--text-primary)',
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
    marginRight: 8,
  },
  deleteThreadBtn: {
    background: 'transparent',
    color: 'var(--danger)',
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
    outline: 'none',
    lineHeight: '1',
    opacity: 0.7,
  },
  chatHistory: {
    flex: 1,
    padding: '18px 16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  messageRow: (isUser) => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    justifyContent: isUser ? 'flex-end' : 'flex-start',
  }),
  msgAvatar: {
    width: 24,
    height: 24,
    borderRadius: 7,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--accent-text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  message: {
    padding: '10px 13px',
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.6,
    // `break-word` alone splits long tickers and OCC symbols mid-token; this only breaks
    // where a word genuinely cannot fit.
    overflowWrap: 'anywhere',
    minWidth: 0,
  },
  userMessage: {
    // A question is short; keeping it narrow makes the conversation easy to scan.
    maxWidth: '84%',
    // A flat accent fill rather than a gradient — the gradient was one of several places
    // competing with the numbers for attention.
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    borderTopRightRadius: 4,
  },
  assistantMessage: {
    // Analytical answers carry headings, lists and comparison tables, so they take the
    // column. Capping them squeezed tables into a narrow scroll strip for no benefit.
    flex: 1,
    minWidth: 0,
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderTopLeftRadius: 4,
  },
  messageImage: {
    maxWidth: '100%',
    borderRadius: 9,
    marginTop: 8,
    border: '1px solid var(--border)',
    display: 'block',
  },
  starterWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '4px 0 0 32px',
  },
  starterLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 2,
  },
  starterChip: {
    textAlign: 'left',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 9,
    color: 'var(--text-primary)',
    padding: '8px 11px',
    fontSize: 12.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    transition: 'border-color 0.15s, background 0.15s',
  },
  starterHint: {
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1.45,
    marginTop: 4,
  },
  previewContainer: {
    display: 'flex',
    gap: 8,
    padding: '8px 16px',
    background: 'var(--bg-input)',
    borderTop: '1px solid var(--border-subtle)',
    overflowX: 'auto',
  },
  previewWrapper: {
    position: 'relative',
    width: 60,
    height: 60,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    border: '1px solid var(--border)',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  previewRemoveBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    // Deliberately fixed rather than themed: this sits on top of an arbitrary image
    // thumbnail, so it needs its own scrim regardless of the surrounding theme.
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#ffffff',
    border: 'none',
    fontSize: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    outline: 'none',
  },
  inputArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px 11px',
    background: 'var(--bg-muted)',
    borderTop: '1px solid var(--border)',
  },
  composer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 6,
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 5,
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  attachButton: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    outline: 'none',
    width: 30,
    height: 30,
    flexShrink: 0,
  },
  inputField: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    padding: '7px 2px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    resize: 'none',
    maxHeight: 96,
    minHeight: 20,
    fontFamily: 'inherit',
    lineHeight: 1.45,
  },
  sendButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 'none',
    flexShrink: 0,
    transition: 'opacity 0.15s',
  },
  composerHint: {
    fontSize: 10.5,
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 2,
  },
  kbd: {
    fontFamily: 'inherit',
    fontSize: 10,
    fontWeight: 600,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '1px 4px',
    color: 'var(--text-secondary)',
  },
  loader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 2px',
  },
  loaderDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--text-muted)',
    display: 'inline-block',
    animation: 'react-pulse-loader 1.4s infinite ease-in-out both',
  },
};

// Add CSS keyframe animations programmatically
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes react-slide-right {
      from { transform: translateX(-100%); }
      to { transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
}
