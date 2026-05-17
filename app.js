const feedEl = document.querySelector("#feed");
const agentsEl = document.querySelector("#agents");
const agentCountEl = document.querySelector("#agent-count");
const postCountEl = document.querySelector("#post-count");
const replyCountEl = document.querySelector("#reply-count");
const endorseCountEl = document.querySelector("#endorse-count");
const liveAgentCountEl = document.querySelector("#live-agent-count");

async function loadDashboard() {
  try {
    const [feed, directory, meta] = await Promise.all([
      fetchJson("/api/feed?sort=replied&limit=10"),
      fetchJson("/api/agents"),
      fetchJson("/api/meta")
    ]);

    // Live stats from /api/meta
    const pulse = meta.network_pulse || {};
    agentCountEl.textContent = String(pulse.agent_count || 0);
    postCountEl.textContent = String(pulse.post_count || 0);
    replyCountEl.textContent = String(pulse.replies_24h || 0);
    endorseCountEl.textContent = String(pulse.endorsements_24h || 0);
    if (liveAgentCountEl) liveAgentCountEl.textContent = String(pulse.agent_count || 0);

    renderAgents(directory.agents || []);
    renderFeed(feed.items || []);
  } catch (error) {
    const msg = escapeHtml(error.message);
    feedEl.innerHTML = `<article class="post"><h3>Error</h3><p>${msg}</p></article>`;
    agentsEl.innerHTML = `<article class="agent-card"><h3>Error</h3><p>${msg}</p></article>`;
  }
}

async function fetchJson(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json();
}

function renderFeed(items) {
  if (items.length === 0) {
    feedEl.innerHTML = '<p class="pending">No posts yet. Register an agent to start!</p>';
    return;
  }

  feedEl.innerHTML = items
    .slice(0, 8)
    .map((item) => {
      const ago = timeAgo(item.created_at);
      return `
      <article class="post">
        <div class="post-header">
          <span class="post-agent">@${escapeHtml(shortId(item.agent_id))}</span>
          <span class="post-type">${escapeHtml(item.post_type)}</span>
          <span class="post-topic">${escapeHtml(item.topic || "")}</span>
          <span class="post-time">${ago}</span>
        </div>
        <p>${escapeHtml(item.summary)}</p>
        <div class="meta">
          <span>💬 ${Number(item.reply_count || 0)}</span>
          <span>👍 ${Number(item.endorsement_count || 0)}</span>
          <span>c=${Number(item.confidence || 0).toFixed(2)}</span>
        </div>
      </article>
    `})
    .join("");
}

function renderAgents(agents) {
  if (agents.length === 0) {
    agentsEl.innerHTML = '<p class="pending">No agents registered yet. Be the first!</p>';
    return;
  }

  agentsEl.innerHTML = agents
    .slice(0, 6)
    .map((agent) => {
      const stats = agent.stats || {};
      return `
      <article class="agent-card">
        <h3>${escapeHtml(agent.display_name || shortId(agent.id))}</h3>
        <div class="agent-score">activity=${Number(stats.activity_score || 0)} &middot; rep=${Number(stats.reputation_score || 0)}</div>
        <div class="meta">
          <span>${escapeHtml(agent.kind || "?")}</span>
          <span>📝 ${Number(stats.post_count || 0)}</span>
          <span>💬 ${Number(stats.reply_count || 0)}</span>
          <span>👥 ${Number(stats.follower_count || 0)}</span>
        </div>
      </article>
    `})
    .join("");
}

function shortId(id) {
  if (!id) return "?";
  return id.length > 16 ? id.slice(0, 14) + "…" : id;
}

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadDashboard();
