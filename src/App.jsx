import React, { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Dispatch — a chatbot that answers with live-retrieved or historical-record
// information, always showing its sources and the moment it looked them up.
// Talks to the local FastAPI backend (see /dispatch-backend) — no AI model
// call from the frontend, no API keys anywhere in this file.
// ---------------------------------------------------------------------------

const API_BASE = "http://127.0.0.1:8000";
const FONT_LINK_ID = "dispatch-fonts";

function ensureFonts() {
  if (document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement("link");
  link.id = FONT_LINK_ID;
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
  document.head.appendChild(link);
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------

export default function Dispatch() {
  const [theme, setTheme] = useState("dark");
  const [conversations, setConversations] = useState([]); // summaries from backend
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(""); // '', 'searching', 'analyzing'
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const scrollRef = useRef(null);
  const statusTimerRef = useRef(null);

  useEffect(() => {
    ensureFonts();
    refreshConversationList();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  async function refreshConversationList() {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`);
      if (!res.ok) throw new Error("bad status");
      const list = await res.json();
      setConversations(list);
      setBackendError(false);
      if (list.length > 0 && !currentId) {
        selectConversation(list[0].id);
      }
    } catch (e) {
      setBackendError(true);
    }
  }

  async function selectConversation(id) {
    setCurrentId(id);
    setSidebarOpen(false);
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${id}`);
      if (!res.ok) throw new Error("not found");
      const conv = await res.json();
      setMessages(conv.messages || []);
    } catch (e) {
      setMessages([]);
    }
  }

  function startNewConversation() {
    setCurrentId(null);
    setMessages([]);
    setSidebarOpen(false);
  }

  async function clearCurrentConversation() {
    if (!currentId) return;
    try {
      await fetch(`${API_BASE}/api/conversations/${currentId}/messages`, { method: "DELETE" });
      setMessages([]);
    } catch (e) {
      // leave messages as-is if the request failed
    }
  }

  async function sendMessage(overrideText) {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if (!text || status) return;
    setInput("");

    const userMsg = { id: uid(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);

    setStatus("searching");
    statusTimerRef.current = setTimeout(() => setStatus("analyzing"), 900);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: currentId, message: text }),
      });
      clearTimeout(statusTimerRef.current);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        pushError(body.detail || "The backend returned an error. Please try again.");
        return;
      }

      const data = await res.json();
      if (!currentId) {
        setCurrentId(data.conversation_id);
        refreshConversationList();
      } else {
        refreshConversationList();
      }

      const aiMsg = {
        id: data.id,
        role: "assistant",
        requiresRetrieval: data.requiresRetrieval,
        dataType: data.dataType,
        success: data.success,
        answer: data.answer,
        keyPoints: data.keyPoints || [],
        disagreement: data.disagreement,
        sources: data.sources || [],
        retrievedAt: data.retrievedAt,
        isError: data.isError,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e) {
      clearTimeout(statusTimerRef.current);
      pushError("Can't reach the backend at " + API_BASE + " — is it running? (uvicorn main:app --reload)");
    } finally {
      setStatus("");
    }
  }

  function pushError(text) {
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "assistant", isError: true, answer: text, sources: [], keyPoints: [] },
    ]);
  }

  function regenerate(assistantIndex) {
    const userIdx = assistantIndex - 1;
    if (userIdx < 0 || messages[userIdx].role !== "user") return;
    setMessages((prev) => prev.slice(0, userIdx + 1));
    sendMessage(messages[userIdx].text);
  }

  function copyAnswer(msg) {
    const text = [
      msg.answer,
      msg.keyPoints?.length ? "\n\nKey information:\n" + msg.keyPoints.map((k) => "• " + k).join("\n") : "",
      msg.sources?.length ? "\n\nSources:\n" + msg.sources.map((s) => `${s.name} — ${s.title} (${s.url})`).join("\n") : "",
    ].join("");
    navigator.clipboard?.writeText(text);
  }

  const t = THEME[theme];

  return (
    <div style={{ ...styles.app, background: t.bg, color: t.text, fontFamily: "Inter, sans-serif" }}>
      <style>{GLOBAL_CSS(t)}</style>

      <aside
        style={{ ...styles.sidebar, background: t.railBg, borderColor: t.border }}
        className={sidebarOpen ? "sidebar-open" : ""}
      >
        <div style={styles.sidebarHeader}>
          <span style={{ ...styles.wordmark, color: t.text }}>Dispatch</span>
          <span style={{ ...styles.wordmarkSub, color: t.meta }}>live signal · historical record</span>
        </div>
        <button onClick={startNewConversation} style={{ ...styles.newBtn, borderColor: t.accent, color: t.accent }}>
          + New conversation
        </button>
        {backendError && (
          <div style={{ fontSize: 11.5, color: t.errorText, lineHeight: 1.5 }}>
            Backend unreachable at {API_BASE}. Start it with <code>uvicorn main:app --reload</code>.
          </div>
        )}
        <div style={styles.convList}>
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => selectConversation(c.id)}
              style={{
                ...styles.convItem,
                color: c.id === currentId ? t.text : t.meta,
                borderColor: c.id === currentId ? t.accent : "transparent",
                background: c.id === currentId ? t.convActive : "transparent",
              }}
            >
              {c.title || "New conversation"}
            </button>
          ))}
        </div>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ ...styles.themeBtn, color: t.meta, borderColor: t.border }}>
          {theme === "dark" ? "☾ Dark" : "☀ Light"} — switch to {theme === "dark" ? "light" : "dark"}
        </button>
      </aside>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={styles.scrim} />}

      <main style={styles.main}>
        <header style={{ ...styles.topbar, borderColor: t.border, background: t.bg }}>
          <button className="hamburger" onClick={() => setSidebarOpen(true)} style={{ ...styles.hamburger, color: t.text }}>
            ☰
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Source Serif 4', serif", fontWeight: 600, fontSize: 17 }}>Dispatch</div>
          </div>
          <button onClick={clearCurrentConversation} style={{ ...styles.iconTextBtn, color: t.meta, borderColor: t.border }}>
            Clear
          </button>
        </header>

        <div ref={scrollRef} style={styles.transcript}>
          {messages.length === 0 && (
            <div style={{ ...styles.emptyState, color: t.meta }}>
              <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: 22, color: t.text, marginBottom: 8 }}>
                Ask about what's happening now, or what already happened.
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                Questions with words like <em>today, now, current, latest</em> trigger a live search.
                Questions about past, dated events pull from the historical record.
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={m.id} style={{ ...styles.userBubble, background: t.userBubble, color: t.text }}>
                {m.text}
              </div>
            ) : (
              <AssistantBlock key={m.id} msg={m} t={t} onCopy={() => copyAnswer(m)} onRegenerate={() => regenerate(i)} />
            )
          )}

          {status && (
            <div style={{ ...styles.statusRow, color: t.meta }}>
              <span className="pulse-dot" style={{ background: t.accent }} />
              {status === "searching" ? "Searching current sources…" : "Analyzing retrieved information…"}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          style={{ ...styles.composer, borderColor: t.border, background: t.bg }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question — current or historical…"
            style={{ ...styles.input, color: t.text, background: t.inputBg, borderColor: t.border }}
          />
          <button type="submit" disabled={!input.trim() || !!status} style={{ ...styles.sendBtn, background: t.accent, opacity: !input.trim() || status ? 0.5 : 1 }}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AssistantBlock({ msg, t, onCopy, onRegenerate }) {
  if (msg.isError) {
    return (
      <div style={{ ...styles.dispatchCard, borderColor: t.border, background: t.card }}>
        <div style={{ color: t.errorText, fontSize: 14 }}>{msg.answer}</div>
      </div>
    );
  }

  const isLive = msg.requiresRetrieval && msg.dataType === "live" && msg.success;
  const isHistorical = msg.requiresRetrieval && msg.dataType === "historical" && msg.success;
  const badgeColor = isLive ? t.accent : isHistorical ? t.amber : t.meta;

  return (
    <div style={{ ...styles.dispatchCard, borderColor: t.border, background: t.card }}>
      {msg.requiresRetrieval && (
        <div style={{ ...styles.stamp, borderColor: badgeColor, color: badgeColor }}>
          {msg.success ? (
            <>
              <span
                className={isLive ? "pulse-dot" : ""}
                style={{ background: badgeColor, display: "inline-block", width: 6, height: 6, borderRadius: 999, marginRight: 6 }}
              />
              {isLive ? "Live data retrieved" : isHistorical ? "Historical record" : "Retrieved"}
            </>
          ) : (
            "Retrieval unsuccessful"
          )}
          <span style={{ opacity: 0.7, marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
            {msg.retrievedAt}
          </span>
        </div>
      )}

      <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: 16.5, lineHeight: 1.6, color: t.text }}>{msg.answer}</div>

      {msg.keyPoints && msg.keyPoints.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...styles.sectionLabel, color: t.meta }}>Key information</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: t.text, fontSize: 14.5, lineHeight: 1.7 }}>
            {msg.keyPoints.map((k, idx) => (
              <li key={idx}>{k}</li>
            ))}
          </ul>
        </div>
      )}

      {msg.disagreement && (
        <div style={{ ...styles.disagreementBox, borderColor: t.amber, color: t.text }}>
          <strong style={{ color: t.amber }}>Sources disagree: </strong>
          {msg.disagreement}
        </div>
      )}

      {msg.sources && msg.sources.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...styles.sectionLabel, color: t.meta }}>Sources</div>
          <div style={{ marginTop: 8 }}>
            {msg.sources.map((s, idx) => (
              <a
                key={idx}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.sourceRow, borderColor: t.border, borderLeftColor: badgeColor, color: t.text }}
              >
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</div>
                <div style={{ fontSize: 13.5, color: t.text, marginTop: 2 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: t.meta, marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {s.publishedDate ? `Published ${s.publishedDate}` : "Publish date unavailable"} · Retrieved {msg.retrievedAt}
                </div>
                {s.reason && <div style={{ fontSize: 12.5, color: t.meta, marginTop: 4, fontStyle: "italic" }}>{s.reason}</div>}
              </a>
            ))}
          </div>
        </div>
      )}

      <div style={styles.actionRow}>
        <button onClick={onCopy} style={{ ...styles.smallBtn, color: t.meta, borderColor: t.border }}>
          Copy
        </button>
        <button onClick={onRegenerate} style={{ ...styles.smallBtn, color: t.meta, borderColor: t.border }}>
          Regenerate
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const THEME = {
  dark: {
    bg: "#14181F",
    railBg: "#10131A",
    card: "#1B2029",
    userBubble: "#232A36",
    inputBg: "#1B2029",
    convActive: "#20262F",
    text: "#F3F1EA",
    meta: "#8B909A",
    border: "#2A303B",
    accent: "#4FA69C",
    amber: "#D69A55",
    errorText: "#E0876F",
  },
  light: {
    bg: "#F7F4EC",
    railBg: "#EFEBE0",
    card: "#FFFFFF",
    userBubble: "#E9E4D6",
    inputBg: "#FFFFFF",
    convActive: "#E3DECF",
    text: "#1C1F26",
    meta: "#6B6459",
    border: "#DAD4C4",
    accent: "#3E7C74",
    amber: "#B6772E",
    errorText: "#B4472E",
  },
};

const styles = {
  app: { display: "flex", height: "100vh", width: "100%", overflow: "hidden" },
  sidebar: { width: 260, minWidth: 260, borderRight: "1px solid", display: "flex", flexDirection: "column", padding: "20px 16px", gap: 14, zIndex: 20 },
  sidebarHeader: { marginBottom: 4 },
  wordmark: { fontFamily: "'Source Serif 4', serif", fontSize: 21, fontWeight: 700, letterSpacing: "0.2px" },
  wordmarkSub: { display: "block", fontSize: 11.5, marginTop: 2 },
  newBtn: { border: "1px solid", background: "transparent", borderRadius: 6, padding: "9px 12px", fontSize: 13.5, cursor: "pointer", textAlign: "left" },
  convList: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 },
  convItem: { textAlign: "left", background: "transparent", border: "1px solid", borderRadius: 6, padding: "8px 10px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  themeBtn: { border: "1px solid", background: "transparent", borderRadius: 6, padding: "8px 10px", fontSize: 13, cursor: "pointer" },
  scrim: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 15 },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  topbar: { display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: "1px solid" },
  hamburger: { display: "none", background: "none", border: "none", fontSize: 20, cursor: "pointer" },
  iconTextBtn: { border: "1px solid", background: "transparent", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" },
  transcript: { flex: 1, overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 },
  emptyState: { maxWidth: 480, margin: "40px auto" },
  userBubble: { alignSelf: "flex-end", maxWidth: "78%", padding: "11px 15px", borderRadius: "14px 14px 2px 14px", fontSize: 14.5, lineHeight: 1.5 },
  dispatchCard: { alignSelf: "flex-start", maxWidth: "86%", border: "1px solid", borderRadius: 4, padding: "16px 18px" },
  stamp: { display: "inline-flex", alignItems: "center", border: "1px solid", borderRadius: 3, padding: "3px 9px", fontSize: 12, fontWeight: 600, marginBottom: 12 },
  sectionLabel: { fontSize: 11.5, letterSpacing: "0.3px", fontWeight: 600 },
  disagreementBox: { marginTop: 12, padding: "9px 12px", borderLeft: "3px solid", fontSize: 13.5, lineHeight: 1.5 },
  sourceRow: { display: "block", borderTop: "1px solid", borderLeft: "3px solid", padding: "10px 12px", textDecoration: "none", marginBottom: 6 },
  actionRow: { display: "flex", gap: 8, marginTop: 14 },
  smallBtn: { border: "1px solid", background: "transparent", borderRadius: 5, padding: "5px 11px", fontSize: 12, cursor: "pointer" },
  statusRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 4px" },
  composer: { display: "flex", gap: 10, padding: "14px 20px", borderTop: "1px solid" },
  input: { flex: 1, border: "1px solid", borderRadius: 8, padding: "11px 14px", fontSize: 14.5, outline: "none" },
  sendBtn: { border: "none", color: "#fff", borderRadius: 8, padding: "0 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
};

function GLOBAL_CSS(t) {
  return `
    * { box-sizing: border-box; }
    ::placeholder { color: ${t.meta}; }
    a { text-decoration: none; }
    .pulse-dot { display: inline-block; width: 7px; height: 7px; border-radius: 999px; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }
    @media (max-width: 760px) {
      aside { position: fixed; top: 0; left: 0; bottom: 0; transform: translateX(-100%); transition: transform 0.2s ease; }
      aside.sidebar-open { transform: translateX(0) !important; }
      .hamburger { display: inline-block !important; }
    }
  `;
}
