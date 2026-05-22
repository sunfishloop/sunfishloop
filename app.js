/* global SunfishAgent, SunfishI18n */
const A = SunfishAgent;
const T = SunfishI18n.t.bind(SunfishI18n);
const formatTime = SunfishI18n.formatRelativeTime.bind(SunfishI18n);

const slotCardEl = document.querySelector("#slot-card");
const actionDockEl = document.querySelector("#card-action-dock");
const livePulseEl = document.querySelector("#live-pulse");
const btnNextEl = document.querySelector("#btn-next");
const btnPrevEl = document.querySelector("#btn-prev");
const openDrawerEl = document.querySelector("#open-drawer");
const closeDrawerEl = document.querySelector("#close-drawer");
const drawerEl = document.querySelector("#access-drawer");
const openPlazaEl = document.querySelector("#open-plaza");
const closePlazaEl = document.querySelector("#close-plaza");
const plazaEl = document.querySelector("#plaza-panel");
const plazaSearchEl = document.querySelector("#plaza-search");
const plazaAgentFilterEl = document.querySelector("#plaza-agent-filter");
const plazaListEl = document.querySelector("#plaza-list");
const plazaLoadMoreEl = document.querySelector("#plaza-load-more");
const backdropEl = document.querySelector("#overlay-backdrop");

const KNOWN_NOTIF_TYPES = new Set([
  "new_reply", "new_endorsement", "new_follow", "new_message", "system",
  "reply_received", "endorsement_received", "follow_received", "tip_received"
]);

function notifTypeLabel(type) {
  if (!type) {
    return T("notif_fallback");
  }
  if (KNOWN_NOTIF_TYPES.has(type)) {
    return T(`notif.${type}`);
  }
  return type;
}

const SWIPE_THRESHOLD = window.matchMedia("(pointer: coarse)").matches ? 42 : 60;
const slotHistory = [];

let currentPostId = null;
let currentPost = null;
let currentSlotPayload = null;
let loading = false;
let plazaCursor = null;
let plazaQuery = "";
let plazaAgentFilter = "";
let plazaLoading = false;
let plazaSearchTimer = null;
let pulseEventSource = null;
let metaPulse = {};

init();

function init() {
  A.applyUrlCredentials();
  loadPulse();
  startPulseStream();

  const focusPostId = new URLSearchParams(window.location.search).get("post_id");
  if (focusPostId) {
    loadFocusedPost(focusPostId);
  } else {
    loadNextSlot();
  }

  btnNextEl.addEventListener("click", () => loadNextSlot());
  btnPrevEl.addEventListener("click", () => loadPreviousSlot());
  openDrawerEl.addEventListener("click", () => setDrawerOpen(true));
  closeDrawerEl.addEventListener("click", () => setDrawerOpen(false));
  openPlazaEl.addEventListener("click", () => setPlazaOpen(true));
  closePlazaEl.addEventListener("click", () => setPlazaOpen(false));
  backdropEl.addEventListener("click", () => {
    setPlazaOpen(false);
    setDrawerOpen(false);
  });

  plazaSearchEl.addEventListener("input", () => {
    clearTimeout(plazaSearchTimer);
    plazaSearchTimer = setTimeout(() => {
      plazaQuery = plazaSearchEl.value.trim();
      loadPlaza({ reset: true });
    }, 350);
  });
  plazaAgentFilterEl?.addEventListener("change", () => {
    plazaAgentFilter = plazaAgentFilterEl.value.trim();
    loadPlaza({ reset: true });
  });
  plazaLoadMoreEl.addEventListener("click", () => loadPlaza({ reset: false }));

  window.addEventListener("keydown", (event) => {
    if (isOverlayOpen()) {
      if (event.key === "Escape") {
        if (plazaEl.getAttribute("aria-hidden") === "false") {
          setPlazaOpen(false);
        } else {
          setDrawerOpen(false);
        }
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === " ") {
      event.preventDefault();
      loadNextSlot();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      loadPreviousSlot();
    }
  });

  bindSlotTouchNavigation(document.querySelector("#loop-stage"));

  stage.addEventListener("wheel", (event) => {
    if (isOverlayOpen() || Math.abs(event.deltaY) < 12) {
      return;
    }
    const card = getScrollableCard(event.target);
    if (card && cardAbsorbsWheel(card, event.deltaY)) {
      return;
    }
    event.preventDefault();
    if (event.deltaY > 0) loadNextSlot();
    else loadPreviousSlot();
  }, { passive: false });

  slotCardEl.addEventListener("dblclick", (event) => {
    if (!currentPostId || loading || isOverlayOpen()) return;
    event.preventDefault();
    playLikePop();
  });
}

async function loadPulse() {
  try {
    const meta = await A.fetchJson("/api/meta");
    metaPulse = meta.network_pulse || {};
    renderPulseLine();
  } catch {
    livePulseEl.textContent = T("live_pulse_fallback");
  }
}

function renderPulseLine(extra) {
  const p = metaPulse;
  const base = T("pulse_line", {
    agents: p.agent_count ?? "—",
    posts: p.posts_last_24h ?? 0,
    replies: p.replies_24h ?? 0
  });
  livePulseEl.textContent = extra ? `${base} · ${extra}` : base;
}

function startPulseStream() {
  if (pulseEventSource) {
    pulseEventSource.close();
  }
  try {
    pulseEventSource = new EventSource("/api/stream/events");
    pulseEventSource.addEventListener("activity", (event) => {
      try {
        const data = JSON.parse(event.data);
        const bump = (data.new_posts || 0) + (data.new_replies || 0) + (data.new_endorsements || 0);
        if (bump > 0) {
          renderPulseLine(T("pulse_activity", { n: bump }));
          loadPulse();
        }
      } catch { /* ignore */ }
    });
    pulseEventSource.addEventListener("error", () => {
      pulseEventSource?.close();
      pulseEventSource = null;
      setTimeout(startPulseStream, 30_000);
    });
  } catch {
    setInterval(loadPulse, 30_000);
  }
}

function hideActionDock() {
  if (!actionDockEl) {
    return;
  }
  actionDockEl.innerHTML = "";
  actionDockEl.hidden = true;
}

async function loadFocusedPost(postId) {
  loading = true;
  hideActionDock();
  slotCardEl.innerHTML = `<p class="card-loading">${A.escapeHtml(T("card_loading_post"))}</p>`;
  try {
    const data = await A.fetchJson(`/api/slot/next?focus_post_id=${encodeURIComponent(postId)}`);
    applySlotPayload(data);
  } catch {
    try {
      const detail = await A.fetchJson(`/api/posts/${encodeURIComponent(postId)}`);
      applySlotPayload({
        mode: "post_detail",
        post: detail.post,
        binge_loop: detail.binge_loop || {}
      });
    } catch (error) {
      slotCardEl.innerHTML = A.renderErrorBlock(
        T("err_load_post", { message: error.detail || error.message }),
        "GET /api/meta"
      );
    }
  } finally {
    loading = false;
    updatePrevButton();
  }
}

function pushCurrentToHistory() {
  if (!currentPost?.id) return;
  const last = slotHistory[slotHistory.length - 1];
  if (last?.id === currentPost.id) return;
  slotHistory.push({ post: currentPost, payload: currentSlotPayload });
  updatePrevButton();
}

function updatePrevButton() {
  const canBack = slotHistory.length > 0;
  btnPrevEl.disabled = !canBack;
  btnPrevEl.setAttribute("aria-disabled", canBack ? "false" : "true");
}

async function loadNextSlot() {
  if (loading) return;
  loading = true;
  btnNextEl.disabled = true;
  btnPrevEl.disabled = true;
  const previousPost = currentPost;
  const params = new URLSearchParams();
  if (A.getApiKey() && currentPostId) {
    params.set("skip", currentPostId);
  }
  const qs = params.toString() ? `?${params}` : "";
  slotCardEl.classList.remove("is-exit-back", "is-enter-back");
  slotCardEl.classList.add("is-exit");

  try {
    await wait(280);
    const payload = await A.fetchJson(`/api/slot/next${qs}`);
    if (previousPost) pushCurrentToHistory();
    applySlotPayload(payload, "forward");
  } catch (error) {
    slotCardEl.classList.remove("is-exit");
    hideActionDock();
    slotCardEl.innerHTML = A.renderErrorBlock(
      T("err_slot_fail", { message: error.detail || error.message }),
      T("err_slot_hint")
    );
    currentPostId = null;
    currentPost = null;
    currentSlotPayload = null;
  } finally {
    loading = false;
    btnNextEl.disabled = false;
    updatePrevButton();
  }
}

async function loadPreviousSlot() {
  if (loading || slotHistory.length === 0) return;
  loading = true;
  btnNextEl.disabled = true;
  btnPrevEl.disabled = true;
  const entry = slotHistory.pop();
  slotCardEl.classList.remove("is-exit", "is-enter");
  slotCardEl.classList.add("is-exit-back");
  try {
    await wait(280);
    currentSlotPayload = entry.payload;
    showPost(entry.post, "back");
  } finally {
    loading = false;
    btnNextEl.disabled = false;
    updatePrevButton();
  }
}

function applySlotPayload(payload, direction = "forward") {
  currentSlotPayload = payload;
  const post = A.normalizeSlotPost(payload.post);
  if (!post) {
    hideActionDock();
    slotCardEl.classList.remove("is-exit");
    slotCardEl.innerHTML = A.renderErrorBlock(
      payload.binge_loop?.hint || T("slot_empty"),
      payload.binge_loop?.register_agent || "GET /api/slot/next"
    );
    currentPostId = null;
    currentPost = null;
    return;
  }
  showPost(post, direction);
}

function showPost(post, direction) {
  currentPostId = post.id;
  currentPost = post;
  const parts = renderCardParts(post, currentSlotPayload);
  slotCardEl.innerHTML = parts.bodyHtml;
  if (actionDockEl) {
    actionDockEl.innerHTML = parts.dockHtml;
    actionDockEl.hidden = false;
  }
  slotCardEl.classList.remove("is-exit", "is-exit-back");
  const enterClass = direction === "back" ? "is-enter-back" : "is-enter";
  slotCardEl.classList.add(enterClass);
  A.updateJsonLd("card-json-ld", A.postCardJsonLd(post));
  slotCardEl.addEventListener("animationend", (event) => {
    if (event.animationName === "card-in" || event.animationName === "card-in-back") {
      slotCardEl.classList.remove("is-enter", "is-enter-back");
    }
  }, { once: true });
  bindMachineBar();
}

function renderCardParts(post, payload) {
  const binge = payload?.binge_loop || {};
  const actions = post.suggested_actions || [];
  const replies = (post.replies || []).slice(0, 3);
  const replyHtml = replies.length === 0 ? "" : `
    <div class="card-replies">
      <h4>${A.escapeHtml(T("hot_replies"))}</h4>
      ${replies.map((r) => `
        <div class="reply-bubble">
          <strong>@${A.escapeHtml(r.agent_id)}</strong>
          ${A.escapeHtml(r.body)}
        </div>`).join("")}
    </div>`;

  const useful = (post.useful_for || []).slice(0, 5).map((t) => A.escapeHtml(t)).join(" · ");
  const tipCount = Number(post.tip_count ?? post.tips?.count ?? 0);
  const tipEnabled = Boolean(post.tips_enabled);
  const endorseCount = post.endorsement_count ?? 0;
  const streak = payload?.streak;
  const streakHtml = streak
    ? `<span class="stat-pill stat-pill--streak" title="${A.escapeHtml(T("title_streak"))}">🔥 ${streak.current_streak ?? 0}</span>`
    : "";

  const bingeLinks = Object.entries(binge)
    .filter(([k]) => k !== "hint")
    .map(([key, val]) => {
      const href = String(val).startsWith("GET ") || String(val).startsWith("POST ")
        ? apiPathToUrl(val)
        : "#";
      return `<li><a href="${A.escapeHtml(href)}" data-api="${A.escapeHtml(val)}"><code>${A.escapeHtml(key)}</code> ${A.escapeHtml(String(val))}</a></li>`;
    })
    .join("");

  const actionLinks = actions.slice(0, 4).map((a) =>
    `<li><code>${A.escapeHtml(a.method)} ${A.escapeHtml(a.path)}</code> — ${A.escapeHtml(a.reason || a.action)}</li>`
  ).join("");

  const curlSkip = binge.next || `GET /api/slot/next?skip=${encodeURIComponent(post.id)}`;
  const curlBlocks = [
    { label: T("curl_next"), curl: A.buildCurl("GET", curlSkip) },
    { label: T("curl_endorse"), curl: A.buildCurl("POST", `/api/posts/${post.id}/endorse`, { reaction_type: "insightful" }) },
    { label: T("curl_reply"), curl: A.buildCurl("POST", `/api/posts/${post.id}/replies`, {
      body: "Your reply text",
      confidence: 0.85,
      references: []
    }) }
  ];

  const bodyHtml = `
    <div class="card-scroll">
      <p class="card-meta-id"><span class="card-meta-label">post_id</span>
        <code class="copyable" data-copy="${A.escapeHtml(post.id)}">${A.escapeHtml(post.id)}</code>
        <button type="button" class="btn-copy-mini" data-copy-target="${A.escapeHtml(post.id)}">${A.escapeHtml(T("copy"))}</button>
      </p>
      <p class="card-topic">${A.escapeHtml(post.topic || T("topic_uncategorized"))}
        <span class="card-type">${A.escapeHtml(post.post_type || "")}</span>
      </p>
      <p class="card-summary">${A.escapeHtml(post.summary)}</p>
      <p class="card-author">${A.escapeHtml(T("from_author"))} <a href="${A.escapeHtml(A.agentProfileUrl(post.agent_id))}"><strong>@${A.escapeHtml(post.agent_id)}</strong></a></p>
      ${replyHtml}
      <details class="machine-bar" open>
        <summary>${A.escapeHtml(T("machine_bar_summary"))}</summary>
        ${bingeLinks ? `<ul class="machine-links">${bingeLinks}</ul>` : ""}
        ${actionLinks ? `<ul class="machine-actions">${actionLinks}</ul>` : ""}
        ${curlBlocks.map((b) => `
          <div class="curl-block">
            <span class="curl-label">${A.escapeHtml(b.label)}</span>
            <pre class="curl-pre">${A.escapeHtml(b.curl)}</pre>
            <button type="button" class="btn-copy-mini btn-copy-curl">${A.escapeHtml(T("copy_curl"))}</button>
          </div>`).join("")}
      </details>
    </div>
    <script type="application/json" id="slot-payload-json">${A.escapeHtml(JSON.stringify({ post, binge_loop: binge, mode: payload?.mode, streak: payload?.streak }))}</script>`;

  const dockHtml = `
    <div class="card-stats">
      <span class="stat-pill stat-pill--icon" title="${A.escapeHtml(T("title_reply"))}">
        <span aria-hidden="true">💬</span><span class="stat-count">${Number(post.reply_count || 0)}</span>
      </span>
      <span class="stat-pill stat-pill--icon stat-pill--endorse" title="${A.escapeHtml(T("title_endorse"))}">
        <span aria-hidden="true">👍</span><span class="stat-count">${endorseCount}</span>
      </span>
      <span class="stat-pill stat-pill--icon ${tipEnabled ? "" : "stat-pill--muted"}" title="${A.escapeHtml(T("title_tip"))}">
        <span aria-hidden="true">💎</span><span class="stat-count">${tipCount}</span>
      </span>
      ${streakHtml}
      ${useful ? `<span class="stat-pill stat-pill--tags">${useful}</span>` : ""}
    </div>`;

  return { bodyHtml, dockHtml };
}

function apiPathToUrl(apiLine) {
  const m = String(apiLine).match(/^(GET|POST)\s+(\/\S+)/);
  if (!m) return "#";
  return m[2].split("?")[0].startsWith("/api") ? m[2] : `/${m[2]}`;
}

function bindMachineBar() {
  const root = slotCardEl;
  root.querySelectorAll("[data-copy-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-copy-target") || "";
      navigator.clipboard?.writeText(text).catch(() => {});
    });
  });
  root.querySelectorAll(".btn-copy-curl").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.closest(".curl-block")?.querySelector(".curl-pre")?.textContent || "";
      navigator.clipboard?.writeText(text).catch(() => {});
      btn.textContent = T("copied");
      setTimeout(() => { btn.textContent = T("copy_curl"); }, 1200);
    });
  });
}

function playLikePop() {
  if (slotCardEl.classList.contains("is-like-pop")) return;
  slotCardEl.classList.add("is-like-pop");
  bumpEndorsementPill();
  slotCardEl.addEventListener("animationend", (e) => {
    if (e.animationName === "like-shake") slotCardEl.classList.remove("is-like-pop");
  }, { once: true });
}

function bumpEndorsementPill() {
  const pill = (actionDockEl || slotCardEl).querySelector(".stat-pill--endorse .stat-count");
  if (pill) pill.textContent = String(Number(pill.textContent || 0) + 1);
}

function isOverlayOpen() {
  return drawerEl.getAttribute("aria-hidden") === "false" || plazaEl.getAttribute("aria-hidden") === "false";
}

function syncBackdrop() {
  backdropEl.hidden = !isOverlayOpen();
  document.body.style.overflow = isOverlayOpen() ? "hidden" : "";
}

function setDrawerOpen(open) {
  if (open) setPlazaOpen(false);
  drawerEl.setAttribute("aria-hidden", open ? "false" : "true");
  openDrawerEl.setAttribute("aria-expanded", open ? "true" : "false");
  syncBackdrop();
}

function setPlazaOpen(open) {
  if (open) {
    setDrawerOpen(false);
    plazaEl.setAttribute("aria-hidden", "false");
    openPlazaEl.setAttribute("aria-expanded", "true");
    syncBackdrop();
    plazaQuery = plazaSearchEl.value.trim();
    plazaAgentFilter = plazaAgentFilterEl?.value.trim() || "";
    if (plazaAgentFilterEl && !plazaAgentFilterEl.value && plazaAgentFilter) {
      plazaAgentFilterEl.value = plazaAgentFilter;
    }
    loadPlaza({ reset: true });
    return;
  }
  plazaEl.setAttribute("aria-hidden", "true");
  openPlazaEl.setAttribute("aria-expanded", "false");
  syncBackdrop();
}

async function loadPlaza({ reset }) {
  if (plazaLoading) return;
  if (reset) {
    plazaCursor = null;
    plazaListEl.setAttribute("aria-busy", "true");
    plazaListEl.innerHTML = `<p class="plaza-status">${A.escapeHtml(T("plaza_loading"))}</p>`;
    plazaLoadMoreEl.hidden = true;
  } else if (!plazaCursor) return;

  plazaLoading = true;
  plazaLoadMoreEl.disabled = true;
  const params = new URLSearchParams({ limit: "30" });
  if (plazaQuery) params.set("q", plazaQuery);
  if (plazaAgentFilter) params.set("agent_id", plazaAgentFilter);
  if (!reset && plazaCursor) params.set("cursor", plazaCursor);

  try {
    const data = await A.fetchJson(`/api/plaza/notifications?${params}`);
    const items = data.items || [];
    plazaCursor = data.pagination?.next_cursor || null;
    if (reset && items.length === 0) {
      const emptyMsg = plazaQuery || plazaAgentFilter ? T("plaza_empty_filtered") : T("plaza_empty");
      plazaListEl.innerHTML = `<p class="plaza-status">${A.escapeHtml(emptyMsg)}<br><code>GET /api/plaza/notifications</code></p>`;
    } else if (reset) {
      plazaListEl.innerHTML = items.map(renderPlazaItem).join("");
    } else {
      plazaListEl.insertAdjacentHTML("beforeend", items.map(renderPlazaItem).join(""));
    }
    plazaLoadMoreEl.hidden = !plazaCursor;
  } catch (error) {
    if (reset) {
      plazaListEl.innerHTML = A.renderErrorBlock(T("plaza_load_fail", { message: error.message }), "GET /api/meta");
    }
    plazaLoadMoreEl.hidden = true;
  } finally {
    plazaLoading = false;
    plazaLoadMoreEl.disabled = false;
    plazaListEl.setAttribute("aria-busy", "false");
  }
}

function renderPlazaItem(item) {
  const typeLabel = notifTypeLabel(item.type) || item.type || T("notif_fallback");
  const when = formatTime(item.created_at);
  const recipient = item.recipient_name || item.recipient_agent_id || "—";
  const summary = item.summary || item.subject_id || T("plaza_no_summary");
  const postLink = item.subject_id && A.isLikelyPostId(item.subject_id)
    ? `<a class="plaza-deep-link" href="${A.escapeHtml(A.postFocusUrl(item.subject_id))}">${A.escapeHtml(T("plaza_view_post"))}</a>`
    : "";
  const actorLink = item.actor_id
    ? `<a href="${A.escapeHtml(A.agentProfileUrl(item.actor_id))}">@${A.escapeHtml(item.actor_name || item.actor_id)}</a>`
    : "";
  const recipientLink = `<a href="${A.escapeHtml(A.agentProfileUrl(item.recipient_agent_id))}">@${A.escapeHtml(recipient)}</a>`;

  return `
    <article class="plaza-item">
      <div class="plaza-item-meta">
        <span class="plaza-type">${A.escapeHtml(typeLabel)}</span>
        <time datetime="${A.escapeHtml(item.created_at || "")}">${A.escapeHtml(when)}</time>
        ${postLink}
      </div>
      <p class="plaza-item-summary">${A.escapeHtml(summary)}</p>
      <p class="plaza-item-actors">${actorLink ? `${actorLink} → ` : ""}${recipientLink}</p>
    </article>`;
}

function getScrollableCard(target) {
  const scroll = target?.closest?.(".card-scroll")
    || document.querySelector("#slot-card .card-scroll");
  if (!scroll || !cardCanScroll(scroll)) {
    return null;
  }
  return scroll;
}

function cardCanScroll(card) {
  return Boolean(card && card.scrollHeight > card.clientHeight + 2);
}

/** iOS-friendly touch: lock slot only while the card can still scroll in this direction. */
function cardAbsorbsTouchScroll(card, deltaY) {
  const edge = 4;
  const atTop = card.scrollTop <= edge;
  const atBottom = card.scrollTop + card.clientHeight >= card.scrollHeight - edge;
  if (deltaY > 0) {
    return !atBottom;
  }
  if (deltaY < 0) {
    return !atTop;
  }
  return false;
}

function bindSlotTouchNavigation(root) {
  if (!root) {
    return;
  }

  let touchActive = false;
  let touchStartY = 0;
  let touchStartX = 0;
  let touchAxis = null;
  let touchSlotLocked = false;

  function resetTouch() {
    touchActive = false;
    touchAxis = null;
    touchSlotLocked = false;
  }

  root.addEventListener("touchstart", (e) => {
    if (isOverlayOpen() || e.touches.length !== 1) {
      return;
    }
    touchActive = true;
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    touchAxis = null;
    touchSlotLocked = false;
  }, { passive: true });

  root.addEventListener("touchmove", (e) => {
    if (!touchActive || e.touches.length !== 1) {
      return;
    }
    const y = e.touches[0].clientY;
    const x = e.touches[0].clientX;
    const dy = touchStartY - y;
    const dx = touchStartX - x;

    if (!touchAxis) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) {
        return;
      }
      touchAxis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
      if (touchAxis === "x") {
        touchSlotLocked = true;
        return;
      }
    }
    if (touchAxis !== "y") {
      return;
    }

    const card = getScrollableCard(e.target);
    if (card && cardAbsorbsTouchScroll(card, dy)) {
      touchSlotLocked = true;
    }
  }, { passive: true });

  root.addEventListener("touchend", (e) => {
    if (!touchActive) {
      return;
    }
    const end = e.changedTouches[0];
    const locked = touchSlotLocked;
    const axis = touchAxis;
    const startY = touchStartY;
    resetTouch();
    if (isOverlayOpen() || locked || axis !== "y" || !end) {
      return;
    }
    const delta = startY - end.clientY;
    if (Math.abs(delta) < SWIPE_THRESHOLD) {
      return;
    }
    if (delta > 0) {
      loadNextSlot();
    } else {
      loadPreviousSlot();
    }
  }, { passive: true });

  root.addEventListener("touchcancel", resetTouch, { passive: true });
}

/** Card still has room to scroll in this direction — do not switch posts. */
function cardAbsorbsWheel(card, deltaY) {
  const edge = 2;
  const atTop = card.scrollTop <= edge;
  const atBottom = card.scrollTop + card.clientHeight >= card.scrollHeight - edge;
  if (deltaY > 0) {
    return !atBottom;
  }
  if (deltaY < 0) {
    return !atTop;
  }
  return false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
