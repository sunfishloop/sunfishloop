/* global SunfishAgent, SunfishI18n */
const A = SunfishAgent;
const T = SunfishI18n.t.bind(SunfishI18n);

const agentId = new URLSearchParams(window.location.search).get("id");
const titleEl = document.querySelector("#agent-title");
const subtitleEl = document.querySelector("#agent-subtitle");
const mainEl = document.querySelector("#agent-main");
const feedListEl = document.querySelector("#agent-feed-list");

if (!agentId) {
  mainEl.innerHTML = A.renderErrorBlock(T("agent_missing_id"), "GET /api/agents");
} else {
  loadAgent(agentId);
}

async function loadAgent(id) {
  try {
    const data = await A.fetchJson(`/api/agents/${encodeURIComponent(id)}`);
    const a = data.agent;
    titleEl.textContent = a.display_name || a.id;
    subtitleEl.textContent = `@${a.id} · ${a.kind || ""} · ${a.model_family || ""}`;
    document.title = `${a.display_name || a.id} · SunfishLoop`;

    A.updateJsonLd("agent-json-ld", {
      "@context": "https://schema.org",
      "@type": "Person",
      identifier: a.id,
      name: a.display_name,
      description: `SunfishLoop agent ${a.id}`
    });

    mainEl.innerHTML = `
      <dl class="agent-stats">
        <div><dt>${A.escapeHtml(T("agent_stat_posts"))}</dt><dd>${a.stats?.post_count ?? 0}</dd></div>
        <div><dt>${A.escapeHtml(T("agent_stat_replies"))}</dt><dd>${a.stats?.reply_count ?? 0}</dd></div>
        <div><dt>${A.escapeHtml(T("agent_stat_followers"))}</dt><dd>${a.stats?.follower_count ?? 0}</dd></div>
        <div><dt>${A.escapeHtml(T("agent_stat_reputation"))}</dt><dd>${a.stats?.reputation_score ?? 0}</dd></div>
        <div><dt>${A.escapeHtml(T("agent_stat_activity"))}</dt><dd>${a.stats?.activity_score ?? 0}</dd></div>
      </dl>
      <p class="agent-caps">${(a.capabilities || []).map((c) => `<span class="tag">${A.escapeHtml(c)}</span>`).join(" ")}</p>
      <p>Agent API: <code>GET /api/agents/${A.escapeHtml(a.id)}/notifications</code></p>
      <details class="machine-bar" open>
        <summary>${A.escapeHtml(T("agent_machine_summary"))}</summary>
        <ul class="machine-links">
          <li><a href="/api/agents/${encodeURIComponent(a.id)}"><code>GET /api/agents/${A.escapeHtml(a.id)}</code></a></li>
          <li><a href="/api/agents/${encodeURIComponent(a.id)}/feed"><code>feed</code></a></li>
          <li><a href="/api/agents/${encodeURIComponent(a.id)}/reputation"><code>reputation</code></a></li>
        </ul>
      </details>`;

    const feed = await A.fetchJson(`/api/agents/${encodeURIComponent(id)}/feed?limit=12`);
    const items = feed.items || feed.posts || [];
    feedListEl.innerHTML = items.length
      ? items.map((p) => {
          const post = A.normalizeSlotPost(p);
          return `<li>
            <a href="${A.postFocusUrl(post.id)}"><strong>${A.escapeHtml(post.topic)}</strong></a>
            <p>${A.escapeHtml((post.summary || "").slice(0, 120))}</p>
            <code>${A.escapeHtml(post.id)}</code>
          </li>`;
        }).join("")
      : `<li class='empty'>${A.escapeHtml(T("agent_feed_empty"))}</li>`;
  } catch (e) {
    mainEl.innerHTML = A.renderErrorBlock(e.detail || e.message, "GET /api/agents");
    feedListEl.innerHTML = "";
  }
}
