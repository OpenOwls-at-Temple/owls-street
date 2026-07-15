import React, { useState, useEffect, useRef } from 'react';

// Unique ID Generator
const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

export default function OwlSpeaksChat({ symbols = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [message, setMessage] = useState('');
  const [attachedImages, setAttachedImages] = useState([]); // Base64 data URIs
  const [isLoading, setIsLoading] = useState(false);

  // Draggable window state
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
      const leftEdge = vw - 24 - 440;
      const topEdge = vh - 96 - 580;
      const margin = 10;
      
      const constrainedX = Math.max(-(leftEdge - margin), Math.min(vw - leftEdge - 440 - margin, newX));
      const constrainedY = Math.max(-(topEdge - margin), Math.min(vh - topEdge - 580 - margin, newY));

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
  }, [isDragging]);

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

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if ((!message.trim() && attachedImages.length === 0) || isLoading) return;

    const userMsg = message;
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

  // Simple Markdown Parser for UI rendering
  const formatMessage = (text) => {
    if (!text) return '';
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)\n```/g, '<pre style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 12px; border: 1px solid rgba(255,255,255,0.05); margin: 6px 0;"><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 12px;">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/---/g, '<hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0;">');
    html = html.replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/\n/g, '<br>');
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  };

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
            <div style={styles.headerLeft}>
              <button
                onClick={() => setShowHistory((prev) => !prev)}
                style={{ ...styles.iconBtn, color: showHistory ? '#6366f1' : '#ffffff' }}
                title="Conversation History"
              >
                <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                </svg>
              </button>
              <div style={styles.headerInfo}>
                <div style={styles.statusDot}></div>
                <span style={styles.headerTitle}>Owl Speaks GPT</span>
              </div>
            </div>
            
            {/* Symbol Context Selector */}
            <select
              value={selectedSymbol}
              onChange={(e) => updateThreadSymbol(e.target.value)}
              style={styles.symbolSelector}
            >
              <option value="">No Context</option>
              {symbols.map((sym) => (
                <option key={sym} value={sym}>
                  Context: {sym}
                </option>
              ))}
            </select>

            <div style={styles.headerActions}>
              <button onClick={clearChatHistory} style={styles.clearBtn} title="Clear history">
                Clear
              </button>
              <button onClick={() => setIsOpen(false)} style={styles.closeBtn} title="Close">
                &times;
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
                        backgroundColor: t.id === activeThreadId ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                        borderColor: t.id === activeThreadId ? '#6366f1' : 'transparent',
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
                {chatHistory.map((msg, index) => (
                  <div
                    key={index}
                    style={{
                      ...styles.message,
                      ...(msg.role === 'user' ? styles.userMessage : styles.assistantMessage),
                    }}
                  >
                    {formatMessage(msg.content)}
                    {/* Render message images if they exist */}
                    {msg.images && msg.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt="Attached Upload"
                        style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8, border: '1px solid rgba(255,255,255,0.1)' }}
                      />
                    ))}
                  </div>
                ))}
                {isLoading && (
                  <div style={{ ...styles.message, ...styles.assistantMessage }}>
                    <div style={styles.loader}>
                      <div style={styles.loaderDot}></div>
                      <div style={styles.loaderDot}></div>
                      <div style={styles.loaderDot}></div>
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
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.attachButton}
                  title="Upload image"
                >
                  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
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
                  placeholder="Ask Owl Speaks (paste chart / screenshots)..."
                  rows={1}
                  style={styles.inputField}
                />

                <button type="submit" disabled={isLoading} style={styles.sendButton}>
                  <svg fill="currentColor" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                    <path d="M3.4 20.4l17.45-7.48c.81-.35.81-1.49 0-1.84L3.4 3.6a.996.996 0 00-1.41.92l.01 5.37c0 .5.37.93.87.98l12.73 1.13c.27.02.27.42 0 .44L2.87 13.57a.993.993 0 00-.87.98l-.01 5.37c-.01.69.65 1.2 1.41.48z" />
                  </svg>
                </button>
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
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#ffffff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
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
    background: 'rgba(17, 24, 39, 0.85)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 9998,
  },
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    outline: 'none',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
  },
  headerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#10b981',
    boxShadow: '0 0 8px #10b981',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#ffffff',
  },
  symbolSelector: {
    background: 'rgba(0, 0, 0, 0.3)',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 11,
    outline: 'none',
    maxWidth: 120,
    cursor: 'pointer',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  clearBtn: {
    background: 'transparent',
    color: '#9ca3af',
    border: 'none',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    outline: 'none',
  },
  closeBtn: {
    background: 'transparent',
    color: '#ffffff',
    border: 'none',
    fontSize: 20,
    cursor: 'pointer',
    outline: 'none',
    lineHeight: '1',
  },
  historyDrawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '60%',
    height: '100%',
    background: 'rgba(11, 15, 26, 0.95)',
    borderRight: '1px solid rgba(255, 255, 255, 0.08)',
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
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  drawerTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  newThreadBtn: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#ffffff',
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
    color: '#e5e7eb',
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
    marginRight: 8,
  },
  deleteThreadBtn: {
    background: 'transparent',
    color: '#ef4444',
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
    outline: 'none',
    lineHeight: '1',
    opacity: 0.7,
  },
  chatHistory: {
    flex: 1,
    padding: 16,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  message: {
    maxWidth: '85%',
    padding: '10px 14px',
    borderRadius: 14,
    fontSize: 13,
    lineHeight: '1.5',
    wordBreak: 'break-word',
  },
  userMessage: {
    alignSelf: 'flex-end',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#ffffff',
    borderBottomRightRadius: 2,
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.15)',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    background: 'rgba(255, 255, 255, 0.05)',
    color: '#e5e7eb',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderBottomLeftRadius: 2,
  },
  previewContainer: {
    display: 'flex',
    gap: 8,
    padding: '8px 16px',
    background: 'rgba(0, 0, 0, 0.15)',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    overflowX: 'auto',
  },
  previewWrapper: {
    position: 'relative',
    width: 60,
    height: 60,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    border: '1px solid rgba(255, 255, 255, 0.1)',
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
    alignItems: 'center',
    gap: 8,
    padding: 12,
    background: 'rgba(255, 255, 255, 0.02)',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
  },
  attachButton: {
    background: 'transparent',
    color: '#9ca3af',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    outline: 'none',
    width: 32,
    height: 32,
  },
  inputField: {
    flex: 1,
    background: 'rgba(0, 0, 0, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    padding: '8px 12px',
    color: '#ffffff',
    fontSize: 13,
    outline: 'none',
    resize: 'none',
    height: 36,
    fontFamily: 'inherit',
    lineHeight: '1.4',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#ffffff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
    outline: 'none',
  },
  loader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
  },
  loaderDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#9ca3af',
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
