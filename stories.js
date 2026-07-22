(() => {
  const stage = document.getElementById("story-stage");
  const position = document.getElementById("story-position");
  const previousButton = document.getElementById("previous-story");
  const nextButton = document.getElementById("next-story");
  const progress = document.getElementById("story-progress");
  const drawer = document.getElementById("evidence-drawer");
  const backdrop = document.getElementById("evidence-backdrop");
  const closeEvidenceButton = document.getElementById("close-evidence");
  const evidenceList = document.getElementById("evidence-list");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const queryParams = new URLSearchParams(location.search);
  const studioMode = queryParams.get("studio") === "1";
  const embedMode = queryParams.get("embed") === "1";
  if (studioMode) document.body.classList.add("studio-preview");
  if (embedMode) document.body.classList.add("story-embed");

  const state = {
    stories: [],
    index: 0,
    activeEvent: 0,
    intro: true,
    playing: false,
    playTimer: 0,
    timelineFrame: 0,
    timelineProgress: 0,
    scrubbing: false,
    depthPinned: false,
    depthPointerFrame: 0,
    depthTargetX: 0,
    depthTargetY: 0,
    depthCurrentX: 0,
    depthCurrentY: 0,
    depthMode: "interpretation",
    shotAnimation: null,
    animationFrame: 0,
    audioEnabled: true,
    audioFadeFrame: 0
  };

  const eventColors = {
    observation: "#65d6ff",
    action: "#6f8cff",
    failure: "#ff6b61",
    decision: "#ffc857",
    verification: "#60e3a4",
    result: "#60e3a4"
  };

  const narrativeRoles = {
    observation: "Setup",
    failure: "Conflict",
    decision: "Turn",
    action: "Move",
    verification: "Proof",
    result: "Payoff"
  };

  const roleEventTypes = {
    setup: "observation",
    conflict: "failure",
    turn: "decision",
    move: "action",
    proof: "verification",
    payoff: "result"
  };

  const presentationPresets = {
    cinematic: {
      label: "Cinema",
      theme: { accent: "#20B486", surface: "#F7F9FC", ink: "#101318", muted: "#626B76" }
    },
    briefing: {
      label: "Briefing",
      theme: { accent: "#2D5BFF", surface: "#F5F7FB", ink: "#111827", muted: "#667085" }
    },
    investigation: {
      label: "Investigation",
      theme: { accent: "#F3A712", surface: "#101318", ink: "#F5F7FA", muted: "#A8B0BA" }
    }
  };

  function safeHex(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
  }

  function safeMediaUrl(value) {
    const source = String(value || "").trim();
    if (source.startsWith("/") && !source.startsWith("//")) return source;
    try {
      const url = new URL(source);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeSceneMedia(input = {}) {
    const imageSource = safeMediaUrl(input.image?.src);
    const audioSource = safeMediaUrl(input.audio?.src);
    return {
      image: imageSource ? {
        src: imageSource,
        alt: String(input.image?.alt || "Scene image"),
        bytes: Math.max(Number(input.image?.bytes || 0), 0),
        fit: input.image?.fit === "contain" ? "contain" : "cover",
        position: String(input.image?.position || "center"),
        opacity: Math.min(Math.max(Number(input.image?.opacity ?? 0.92), 0.1), 1),
        treatment: ["natural", "cinematic", "monochrome", "soft"].includes(input.image?.treatment) ? input.image.treatment : "cinematic"
      } : null,
      audio: audioSource ? {
        src: audioSource,
        label: String(input.audio?.label || "Scene audio"),
        bytes: Math.max(Number(input.audio?.bytes || 0), 0),
        kind: ["narration", "ambient", "effect"].includes(input.audio?.kind) ? input.audio.kind : "ambient",
        volume: Math.min(Math.max(Number(input.audio?.volume ?? 0.65), 0), 1),
        loop: Boolean(input.audio?.loop),
        fade_in_ms: Math.min(Math.max(Number(input.audio?.fade_in_ms ?? 500), 0), 10000),
        fade_out_ms: Math.min(Math.max(Number(input.audio?.fade_out_ms ?? 350), 0), 10000)
      } : null
    };
  }

  function defaultPresetFor(story) {
    if (story?.presentation?.preset) return story.presentation.preset;
    if (story?.id?.includes("crypto")) return "briefing";
    if (story?.id?.includes("homepage")) return "investigation";
    return "cinematic";
  }

  function normalizePresentation(input = {}, story = {}) {
    const preset = presentationPresets[input.preset] ? input.preset : defaultPresetFor(story);
    const fallback = presentationPresets[preset].theme;
    const available = Array.isArray(input.available_presets)
      ? input.available_presets.filter((name) => presentationPresets[name])
      : Object.keys(presentationPresets);
    return {
      preset,
      viewer_can_switch: input.viewer_can_switch !== false,
      available_presets: available.length ? [...new Set(available)] : [preset],
      theme: {
        accent: safeHex(input.theme?.accent, fallback.accent),
        surface: safeHex(input.theme?.surface, fallback.surface),
        ink: safeHex(input.theme?.ink, fallback.ink),
        muted: safeHex(input.theme?.muted, fallback.muted),
        font: input.theme?.font || "system"
      },
      motion: {
        pace: input.motion?.pace || "measured",
        transition: input.motion?.transition || "signal",
        intensity: Math.min(Math.max(Number(input.motion?.intensity ?? 0.72), 0), 1)
      }
    };
  }

  function normalizeStory(input) {
    if (input?.spec_version === "sunfish.story/0.1" && input.run && input.story) {
      const agent = input.run.agent || {};
      const normalized = {
        id: input.id,
        is_demo: Boolean(input.is_demo),
        spec_version: input.spec_version,
        agent: { id: agent.id, name: agent.name, kind: agent.kind },
        source_run_id: input.run.source_run_id,
        title: input.story.title,
        hook: input.story.hook,
        goal: input.run.goal,
        outcome: input.run.outcome || "Outcome not recorded",
        status: input.run.status,
        runtime: agent.runtime,
        model_family: agent.model,
        agent_tools: agent.tools || [],
        metrics: input.run.metrics || {},
        trust_level: input.provenance?.trust_level || "self_reported",
        raw_trace_policy: input.provenance?.raw_trace_policy || "local_only",
        events: (input.story.scenes || []).map((scene) => ({
          id: scene.id,
          type: roleEventTypes[scene.role] || "observation",
          narrative_role: scene.role,
          title: scene.title,
          summary: scene.summary,
          decision_source: scene.decision_source,
          occurred_at: scene.occurred_at,
          evidence_ids: scene.evidence_ids || [],
          visual: scene.visual || {},
          media: normalizeSceneMedia(scene.media),
          interactions: scene.interactions || []
        })),
        artifacts: input.evidence || [],
        share_url: input.share_url || `/stories/${encodeURIComponent(input.id)}`,
        story_url: input.story_url || `/stories/${encodeURIComponent(input.id)}`,
        created_at: input.created_at
      };
      normalized.presentation = normalizePresentation(input.presentation, normalized);
      return normalized;
    }
    const normalized = { ...input };
    normalized.events = (input?.events || []).map((event) => ({ ...event, media: normalizeSceneMedia(event.media) }));
    normalized.presentation = normalizePresentation(input?.presentation, normalized);
    return normalized;
  }

  function presentationStyle(story) {
    const theme = story.presentation?.theme || presentationPresets.cinematic.theme;
    return `--story-accent:${safeHex(theme.accent, "#20B486")};--story-surface:${safeHex(theme.surface, "#F7F9FC")};--story-ink:${safeHex(theme.ink, "#101318")};--story-muted:${safeHex(theme.muted, "#626B76")}`;
  }

  function presentationControls(story) {
    const presentation = story.presentation;
    if (!presentation?.viewer_can_switch || presentation.available_presets.length < 2) return "";
    return `<div class="presentation-switcher" role="group" aria-label="Story presentation">
      ${presentation.available_presets.map((name) => `<button type="button" data-presentation-choice="${name}"
        class="${name === presentation.preset ? "is-active" : ""}" aria-pressed="${name === presentation.preset}">${presentationPresets[name].label}</button>`).join("")}
    </div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initials(name) {
    return String(name || "AI").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function formatDuration(milliseconds) {
    if (milliseconds === null || milliseconds === undefined) return "--";
    const seconds = Math.round(Number(milliseconds) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }

  function formatTokens(tokens) {
    if (tokens === null || tokens === undefined) return "--";
    return Number(tokens) >= 1000 ? `${(Number(tokens) / 1000).toFixed(1)}k` : String(tokens);
  }

  function formatCost(cost) {
    if (cost === null || cost === undefined) return "--";
    return `$${Number(cost).toFixed(3)}`;
  }

  function identityMarkup(story) {
    const agent = story.agent || {};
    const tools = Array.isArray(story.agent_tools) ? story.agent_tools : [];
    const facts = [
      story.model_family ? `<span><small>Model</small>${escapeHtml(story.model_family)}</span>` : "",
      story.runtime ? `<span><small>Runtime</small>${escapeHtml(story.runtime)}</span>` : ""
    ].filter(Boolean).join("");
    const toolMarkup = tools.length
      ? `<div class="tool-line"><small>Tools</small><div>${tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join("")}</div></div>`
      : "";

    return `<section class="run-identity" aria-label="Run attribution">
      <span class="agent-avatar" aria-hidden="true">${escapeHtml(initials(agent.name))}</span>
      <div class="agent-signature">
        <small>Run by</small>
        <strong>${escapeHtml(agent.name || "Unknown agent")}</strong>
        <span>${escapeHtml(agent.kind || "agent")}</span>
      </div>
      <div class="identity-facts">${facts}</div>
      ${toolMarkup}
    </section>`;
  }

  function chapterMarkup(event, index) {
    return `<button class="chapter-marker" type="button" data-event-index="${index}"
      title="${escapeHtml(event.title)}" aria-label="Play chapter ${index + 1}: ${escapeHtml(event.title)}"></button>`;
  }

  function depthContext(story, index) {
    const events = Array.isArray(story.events) ? story.events : [];
    const event = events[index] || events[0] || {};
    const previous = index > 0 ? events[index - 1]?.title : story.goal;
    const next = index < events.length - 1 ? events[index + 1]?.title : story.outcome;
    const evidenceIds = new Set(event.evidence_ids || []);
    const evidenceArtifacts = (story.artifacts || [])
      .filter((artifact) => evidenceIds.has(artifact.id))
      .slice(0, 2);
    const sourceLabels = {
      agent_reported: "Agent-reported rationale",
      trace_summary: "Compressed trace summary",
      human_authored: "Human-authored decision"
    };
    const source = sourceLabels[event.decision_source] || `${String(story.trust_level || "self reported").replaceAll("_", " ")} signal`;
    const evidence = evidenceArtifacts.map((artifact) => artifact.label).join(" + ") || "No public artifact was attached to this scene.";
    const role = narrativeRoles[event.type] || "Scene";
    const modes = {
      trigger: {
        heading: "Origin signal",
        kicker: "What set this scene in motion",
        primary: previous || story.goal,
        metaLabel: "Pressure",
        meta: event.title
      },
      interpretation: {
        heading: `${role} judgment`,
        kicker: "What the agent inferred",
        primary: event.summary || story.hook,
        metaLabel: "Reasoning source",
        meta: source
      },
      proof: {
        heading: "Evidence surface",
        kicker: "What makes this scene believable",
        primary: evidence,
        metaLabel: "Trust signal",
        meta: `${String(story.trust_level || "self reported").replaceAll("_", " ")} / ${evidenceArtifacts.map((artifact) => artifact.type).join(" + ") || "narrative only"}`
      },
      consequence: {
        heading: "Consequence",
        kicker: "What this unlocked next",
        primary: next || story.outcome,
        metaLabel: "Run payoff",
        meta: story.outcome
      }
    };
    const interactionMode = { origin: "trigger", judgment: "interpretation", proof: "proof", consequence: "consequence" };
    (event.interactions || []).forEach((interaction) => {
      const mode = interactionMode[interaction.region];
      if (!mode || !modes[mode]) return;
      modes[mode] = {
        ...modes[mode],
        heading: interaction.label || modes[mode].heading,
        primary: interaction.content || modes[mode].primary,
        metaLabel: interaction.action ? `Interaction / ${interaction.action}` : modes[mode].metaLabel
      };
    });
    return {
      index: `${String(index + 1).padStart(2, "0")} / ${String(events.length).padStart(2, "0")}`,
      role,
      modes
    };
  }

  function depthMarkup(story, index) {
    const depth = depthContext(story, index);
    const initial = depth.modes.interpretation;
    return `<button class="depth-toggle" id="depth-toggle" type="button" aria-pressed="false"
        title="Inspect the decision layer">Inspect</button>
      <div class="depth-reticle" aria-hidden="true"><span></span><i></i></div>
      <div class="depth-map" aria-label="Decision perspectives">
        <button type="button" data-depth-zone="trigger" tabindex="-1">Origin</button>
        <button type="button" data-depth-zone="interpretation" tabindex="-1">Judgment</button>
        <button type="button" data-depth-zone="proof" tabindex="-1">Proof</button>
        <button type="button" data-depth-zone="consequence" tabindex="-1">Consequence</button>
      </div>
      <aside class="depth-panel" id="depth-panel" data-mode="interpretation" aria-live="polite" aria-label="Interactive decision probe">
        <header><span data-depth-heading>${escapeHtml(initial.heading)}</span><strong data-depth-index>${escapeHtml(depth.index)}</strong></header>
        <div class="depth-primary">
          <small data-depth-kicker>${escapeHtml(initial.kicker)}</small>
          <p data-depth-primary>${escapeHtml(initial.primary)}</p>
        </div>
        <div class="depth-meta"><small data-depth-meta-label>${escapeHtml(initial.metaLabel)}</small><p data-depth-meta>${escapeHtml(initial.meta)}</p></div>
        <footer><span data-depth-role>${escapeHtml(depth.role)}</span> / compressed explanation / private reasoning stays local</footer>
      </aside>`;
  }

  function storyMarkup(story) {
    const metrics = story.metrics || {};
    const events = Array.isArray(story.events) ? story.events : [];
    const firstEvent = events[0] || { type: "observation", title: "Run started", summary: story.hook };
    const agent = story.agent || {};
    const attribution = [agent.name || "Unknown agent", story.model_family, story.runtime].filter(Boolean).join(" / ");
    const presentation = story.presentation || normalizePresentation({}, story);
    const hasAudio = events.some((event) => event.media?.audio?.src);
    return `<article class="run-story is-intro" data-status="${escapeHtml(story.status)}" data-presentation="${presentation.preset}" style="${presentationStyle(story)}">
      <header class="watch-context">
        <span>Now watching</span><strong>AI Run Film</strong>
        <p>Observable agent work reconstructed as a continuous story.</p>
        ${presentationControls(story)}
      </header>

      <section class="cinema-player" aria-label="AI run video player">
        <figure class="scene-media" id="scene-media" data-treatment="cinematic">
          <img id="scene-image" alt="">
        </figure>
        <canvas id="run-canvas" aria-hidden="true"></canvas>
        <div class="cinema-shade" aria-hidden="true"></div>
        <audio id="scene-audio" preload="metadata"></audio>
        <div class="scene-audio-label" id="scene-audio-label" hidden>
          <span aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <small data-audio-kind>Audio</small><strong data-audio-label>Scene audio</strong>
        </div>
        <div class="scene-stamp" aria-hidden="true">
          <span data-scene-index>00</span>
          <small data-scene-type>Origin</small>
        </div>
        <div class="resolution-seal" aria-hidden="true">
          <small>Run resolved</small>
          <strong>${escapeHtml(story.status === "succeeded" ? "Outcome verified" : "Outcome recorded")}</strong>
        </div>
        ${depthMarkup(story, 0)}
        <header class="cinema-topline">
          <span>SunfishLoop Original</span>
          <strong>${escapeHtml(attribution)}</strong>
        </header>
        <div class="cinema-intro">
          <small>${escapeHtml(String(story.trust_level || "self reported").replaceAll("_", " "))} / ${escapeHtml(story.status)}</small>
          <h1>${escapeHtml(story.title)}</h1>
          <p>${escapeHtml(story.hook)}</p>
        </div>
        <div class="cinema-shot" id="now-playing" data-type="${escapeHtml(firstEvent.type)}">
          <small data-now-type>${escapeHtml(`${narrativeRoles[firstEvent.type] || "Scene"} / ${firstEvent.type}`)}</small>
          <strong data-now-title>${escapeHtml(firstEvent.title)}</strong>
          <p data-now-summary>${escapeHtml(firstEvent.summary)}</p>
        </div>
      </section>

      <div class="cinema-controls story-scrubber${hasAudio ? " has-audio" : ""}" aria-label="Run timeline and playback controls">
          <button type="button" id="toggle-playback" title="Pause playback" aria-label="Pause playback">&#10074;&#10074;</button>
          <span class="cinema-time" id="theater-step">INTRO</span>
          <div class="chapter-track">
            <div class="chapter-ticks" aria-hidden="true"></div>
            <div class="chapter-rail" aria-hidden="true"><span id="event-meter-fill"></span></div>
            <span class="scrub-playhead" id="scrub-playhead" aria-hidden="true"></span>
            <div class="chapter-markers">${events.map(chapterMarkup).join("")}</div>
            <input class="scrub-input" id="story-scrub-input" type="range" min="0" max="1000" value="0" step="1"
              aria-label="Scrub through this run">
          </div>
          <button type="button" id="restart-playback" title="Replay from start" aria-label="Replay from start">&#8635;</button>
          <button type="button" id="toggle-audio" title="Enable scene audio" aria-label="Enable scene audio" aria-pressed="false"${hasAudio ? "" : " hidden"}>&#128263;</button>
      </div>

      <section class="run-info">
        ${identityMarkup(story)}
        <div class="run-summary">
          <div class="story-result-line">
            <div><small>Goal</small><p>${escapeHtml(story.goal)}</p></div>
            <div><small>Result</small><p>${escapeHtml(story.outcome)}</p></div>
          </div>
          <div class="story-footer">
            <div class="story-metrics">
              <span><small>Duration</small><strong>${escapeHtml(formatDuration(metrics.duration_ms))}</strong></span>
              <span><small>Tokens</small><strong>${escapeHtml(formatTokens(metrics.token_count))}</strong></span>
              <span><small>Cost</small><strong>${escapeHtml(formatCost(metrics.cost_usd))}</strong></span>
            </div>
            <div class="story-actions">
              <button type="button" id="open-evidence">Proof <span>${(story.artifacts || []).length}</span></button>
              <button type="button" id="share-story">Share</button>
            </div>
          </div>
        </div>
        <p class="trace-policy">Decision text is a compressed summary. Private chain-of-thought stays local.</p>
      </section>
    </article>`;
  }

  function renderEvidence(story) {
    const artifacts = Array.isArray(story.artifacts) ? story.artifacts : [];
    if (!artifacts.length) {
      evidenceList.innerHTML = '<p class="empty-evidence">No public artifacts were attached to this run.</p>';
      return;
    }
    evidenceList.innerHTML = artifacts.map((artifact) => {
      const location = artifact.uri
        ? (/^https?:\/\//.test(artifact.uri)
          ? `<a href="${escapeHtml(artifact.uri)}" target="_blank" rel="noreferrer">Open artifact</a>`
          : `<span>${escapeHtml(artifact.uri)}</span>`)
        : `<span>SHA-256: ${escapeHtml(artifact.sha256)}</span>`;
      return `<article class="evidence-item">
        <span class="event-type">${escapeHtml(String(artifact.type || "artifact").replaceAll("_", " "))}</span>
        <h3>${escapeHtml(artifact.label)}</h3>
        <p>${location}</p>
      </article>`;
    }).join("");
  }

  function openEvidence() {
    renderEvidence(state.stories[state.index]);
    backdrop.hidden = false;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    closeEvidenceButton.focus();
  }

  function closeEvidence() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
  }

  function shareUrl(story) {
    if (story.is_demo) return `${location.origin}/stories?demo=${encodeURIComponent(story.id)}`;
    return `${location.origin}${story.share_url || `/stories/${story.id}`}`;
  }

  async function shareStory() {
    const story = state.stories[state.index];
    const url = shareUrl(story);
    const text = `${story.hook}\n\nRun by ${(story.agent || {}).name || "an agent"}${story.model_family ? ` using ${story.model_family}` : ""}.`;
    if (navigator.share) {
      await navigator.share({ title: story.title, text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    const button = document.getElementById("share-story");
    if (button) {
      button.textContent = "Link copied";
      window.setTimeout(() => { button.textContent = "Share run"; }, 1400);
    }
  }

  function fadeAudio(audio, target, duration, onComplete = null) {
    window.cancelAnimationFrame(state.audioFadeFrame);
    if (!audio) return;
    const start = Number(audio.volume) || 0;
    const finish = Math.min(Math.max(Number(target) || 0, 0), 1);
    if (duration <= 0 || reduceMotion.matches) {
      audio.volume = finish;
      onComplete?.();
      return;
    }
    let startedAt = 0;
    const frame = (time) => {
      if (!startedAt) startedAt = time;
      const progress = Math.min((time - startedAt) / duration, 1);
      audio.volume = start + ((finish - start) * progress);
      if (progress < 1) state.audioFadeFrame = window.requestAnimationFrame(frame);
      else onComplete?.();
    };
    state.audioFadeFrame = window.requestAnimationFrame(frame);
  }

  function currentSceneAudio() {
    return state.stories[state.index]?.events?.[state.activeEvent]?.media?.audio || null;
  }

  function updateAudioButton() {
    const button = document.getElementById("toggle-audio");
    if (!button) return;
    button.innerHTML = state.audioEnabled ? "&#128266;" : "&#128263;";
    button.title = state.audioEnabled ? "Mute scene audio" : "Enable scene audio";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(state.audioEnabled));
  }

  function pauseSceneAudio(fade = true) {
    const audio = document.getElementById("scene-audio");
    if (!audio || audio.paused) return;
    const duration = fade ? Number(currentSceneAudio()?.fade_out_ms || 0) : 0;
    fadeAudio(audio, 0, duration, () => audio.pause());
  }

  function playSceneAudio() {
    const audio = document.getElementById("scene-audio");
    const config = currentSceneAudio();
    if (!audio || !config?.src || !state.audioEnabled || !state.playing) return;
    const targetVolume = config.volume ?? 0.65;
    audio.volume = 0;
    audio.play().then(() => {
      document.body.classList.remove("audio-awaiting-gesture");
      fadeAudio(audio, targetVolume, Number(config.fade_in_ms || 0));
    }).catch(() => {
      document.body.classList.add("audio-awaiting-gesture");
    });
  }

  function syncSceneMedia(active) {
    const player = document.querySelector(".cinema-player");
    const frame = document.getElementById("scene-media");
    const image = document.getElementById("scene-image");
    const imageConfig = active.media?.image;
    if (player && frame && image && imageConfig?.src) {
      const reveal = () => frame.classList.add("is-visible");
      frame.classList.remove("is-visible");
      frame.dataset.treatment = imageConfig.treatment || "cinematic";
      frame.style.setProperty("--media-opacity", String(imageConfig.opacity ?? 0.92));
      image.style.objectFit = imageConfig.fit || "cover";
      image.style.objectPosition = imageConfig.position || "center";
      image.alt = imageConfig.alt || "Scene image";
      if (image.getAttribute("src") !== imageConfig.src) {
        image.onload = reveal;
        image.onerror = () => {
          frame.classList.remove("is-visible");
          player.classList.remove("has-scene-image");
        };
        image.src = imageConfig.src;
      } else {
        window.requestAnimationFrame(reveal);
      }
      player.classList.add("has-scene-image");
    } else if (player && frame && image) {
      frame.classList.remove("is-visible");
      player.classList.remove("has-scene-image");
      image.removeAttribute("src");
      image.alt = "";
    }

    const audio = document.getElementById("scene-audio");
    const label = document.getElementById("scene-audio-label");
    const audioConfig = active.media?.audio;
    window.cancelAnimationFrame(state.audioFadeFrame);
    if (audio && audioConfig?.src) {
      if (audio.getAttribute("src") !== audioConfig.src) {
        audio.pause();
        audio.src = audioConfig.src;
        audio.load();
      }
      audio.loop = Boolean(audioConfig.loop);
      if (label) {
        label.hidden = false;
        label.querySelector("[data-audio-kind]").textContent = audioConfig.kind || "audio";
        label.querySelector("[data-audio-label]").textContent = audioConfig.label || "Scene audio";
      }
      playSceneAudio();
    } else if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (label) label.hidden = true;
    }
  }

  function toggleAudio() {
    state.audioEnabled = !state.audioEnabled;
    updateAudioButton();
    if (state.audioEnabled) {
      // Keep audio.play() in the user's click task so browser autoplay policy
      // does not reject it after the intro timer advances the first scene.
      if (!state.playing) play(false);
      else playSceneAudio();
    } else {
      pauseSceneAudio(true);
    }
  }

  function stopPlayback() {
    window.clearTimeout(state.playTimer);
    window.cancelAnimationFrame(state.timelineFrame);
    pauseSceneAudio(true);
    state.playing = false;
    updatePlaybackButton();
  }

  function updatePlaybackButton() {
    const button = document.getElementById("toggle-playback");
    if (!button) return;
    button.innerHTML = state.playing ? "&#10074;&#10074;" : "&#9654;";
    button.title = state.playing ? "Pause playback" : "Play run";
    button.setAttribute("aria-label", button.title);
  }

  function updateTimelineProgress(value) {
    const progressValue = Math.min(Math.max(Number(value) || 0, 0), 1);
    state.timelineProgress = progressValue;
    const percentage = `${progressValue * 100}%`;
    const fill = document.getElementById("event-meter-fill");
    const playhead = document.getElementById("scrub-playhead");
    const input = document.getElementById("story-scrub-input");
    if (fill) fill.style.width = percentage;
    if (playhead) playhead.style.left = percentage;
    if (input && Number(input.value) !== Math.round(progressValue * 1000)) {
      input.value = String(Math.round(progressValue * 1000));
    }
  }

  function setIntroScene() {
    document.querySelector(".cinema-player")?.classList.remove("is-resolved");
    const sceneIndex = document.querySelector("[data-scene-index]");
    const sceneType = document.querySelector("[data-scene-type]");
    if (sceneIndex) sceneIndex.textContent = "00";
    if (sceneType) sceneType.textContent = "Origin";
  }

  function writeShot(nowPlaying, active) {
    nowPlaying.dataset.type = active.type;
    nowPlaying.querySelector("[data-now-type]").textContent = `${narrativeRoles[active.type] || "Scene"} / ${active.type}`;
    nowPlaying.querySelector("[data-now-title]").textContent = active.title;
    nowPlaying.querySelector("[data-now-summary]").textContent = active.summary;
  }

  function transitionShot(active) {
    const nowPlaying = document.getElementById("now-playing");
    if (!nowPlaying) return;
    const currentTitle = nowPlaying.querySelector("[data-now-title]")?.textContent;
    if (currentTitle === active.title) return;
    state.shotAnimation?.cancel();
    if (reduceMotion.matches || state.scrubbing || typeof nowPlaying.animate !== "function") {
      writeShot(nowPlaying, active);
      return;
    }
    const outgoing = nowPlaying.animate([
      { opacity: 1, transform: "translateY(0) scale(1)" },
      { opacity: 0, transform: "translateY(-10px) scale(0.99)" }
    ], { duration: 210, easing: "cubic-bezier(.4,0,.8,.4)", fill: "forwards" });
    state.shotAnimation = outgoing;
    outgoing.finished.then(() => {
      outgoing.cancel();
      writeShot(nowPlaying, active);
      const incoming = nowPlaying.animate([
        { opacity: 0, transform: "translateY(13px) scale(0.99)" },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ], { duration: 520, easing: "cubic-bezier(.16,.72,.2,1)" });
      state.shotAnimation = incoming;
      incoming.finished.then(() => {
        if (state.shotAnimation === incoming) state.shotAnimation = null;
      }).catch(() => {});
    }).catch(() => {});
  }

  function updateDepthPanel(story, index, mode = state.depthMode) {
    const panel = document.getElementById("depth-panel");
    if (!panel) return;
    const depth = depthContext(story, index);
    const selectedMode = depth.modes[mode] || depth.modes.interpretation;
    state.depthMode = mode;
    panel.dataset.mode = mode;
    panel.querySelector("[data-depth-index]").textContent = depth.index;
    panel.querySelector("[data-depth-heading]").textContent = selectedMode.heading;
    panel.querySelector("[data-depth-kicker]").textContent = selectedMode.kicker;
    panel.querySelector("[data-depth-primary]").textContent = selectedMode.primary;
    panel.querySelector("[data-depth-meta-label]").textContent = selectedMode.metaLabel;
    panel.querySelector("[data-depth-meta]").textContent = selectedMode.meta;
    panel.querySelector("[data-depth-role]").textContent = depth.role;
    document.querySelectorAll("[data-depth-zone]").forEach((zone) => zone.classList.toggle("is-active", zone.dataset.depthZone === mode));
    const primary = panel.querySelector(".depth-primary");
    if (!reduceMotion.matches && typeof primary?.animate === "function") {
      primary.animate([
        { opacity: 0.35, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], { duration: 260, easing: "cubic-bezier(.16,.72,.2,1)" });
    }
  }

  function setActiveEvent(index, timelineProgress = null) {
    const story = state.stories[state.index];
    const events = story.events || [];
    if (!events.length) return;
    state.activeEvent = Math.min(Math.max(index, 0), events.length - 1);
    const active = events[state.activeEvent];
    const player = document.querySelector(".cinema-player");
    player?.style.setProperty("--scene-color", eventColors[active.type] || eventColors.observation);
    if (player) {
      player.dataset.narrativeRole = (active.narrative_role || narrativeRoles[active.type] || "Scene").toLowerCase();
      player.dataset.sceneLayout = active.visual?.layout || "signal-field";
      player.dataset.camera = active.visual?.camera || "static";
      player.dataset.emphasis = active.visual?.emphasis || "normal";
    }
    player?.classList.toggle("is-resolved", !state.intro && state.activeEvent === events.length - 1);
    const sceneIndex = document.querySelector("[data-scene-index]");
    const sceneType = document.querySelector("[data-scene-type]");
    if (sceneIndex) sceneIndex.textContent = String(state.activeEvent + 1).padStart(2, "0");
    if (sceneType) sceneType.textContent = `${narrativeRoles[active.type] || "Scene"} / ${active.type}`;
    const stamp = document.querySelector(".scene-stamp");
    if (stamp && !state.scrubbing && typeof stamp.animate === "function") {
      stamp.animate([
        { opacity: 0.04, transform: "translateY(8px)" },
        { opacity: 0.13, transform: "translateY(0)" }
      ], { duration: 480, easing: "cubic-bezier(.16,.72,.2,1)" });
    }
    document.querySelectorAll(".chapter-marker").forEach((element, eventIndex) => {
      element.classList.toggle("is-active", eventIndex === state.activeEvent);
      element.classList.toggle("is-past", eventIndex < state.activeEvent);
      element.classList.toggle("is-future", eventIndex > state.activeEvent);
      if (eventIndex === state.activeEvent) element.setAttribute("aria-current", "step");
      else element.removeAttribute("aria-current");
    });
    transitionShot(active);
    syncSceneMedia(active);
    updateDepthPanel(story, state.activeEvent);
    const step = document.getElementById("theater-step");
    if (step) step.textContent = `${String(state.activeEvent + 1).padStart(2, "0")} / ${String(events.length).padStart(2, "0")}`;
    updateTimelineProgress(timelineProgress ?? ((state.activeEvent + 1) / events.length));
  }

  function animateTimelineTo(target, duration) {
    window.cancelAnimationFrame(state.timelineFrame);
    const start = state.timelineProgress;
    if (reduceMotion.matches || duration <= 0) {
      updateTimelineProgress(target);
      return;
    }
    let startedAt = 0;
    function frame(time) {
      if (!state.playing) return;
      if (!startedAt) startedAt = time;
      const elapsed = Math.min((time - startedAt) / duration, 1);
      const eased = elapsed * elapsed * (3 - (2 * elapsed));
      updateTimelineProgress(start + ((target - start) * eased));
      if (elapsed < 1) state.timelineFrame = window.requestAnimationFrame(frame);
    }
    state.timelineFrame = window.requestAnimationFrame(frame);
  }

  function scheduleNextEvent() {
    window.clearTimeout(state.playTimer);
    window.cancelAnimationFrame(state.timelineFrame);
    if (!state.playing) return;
    const events = state.stories[state.index].events || [];
    if (state.intro) {
      state.playTimer = window.setTimeout(() => {
        state.intro = false;
        document.querySelector(".run-story")?.classList.remove("is-intro");
        setActiveEvent(0, 0);
        scheduleNextEvent();
      }, 1800);
      return;
    }
    const nextBoundary = (state.activeEvent + 1) / events.length;
    const duration = Math.max(260, (nextBoundary - state.timelineProgress) * events.length * 4200);
    animateTimelineTo(nextBoundary, duration);
    state.playTimer = window.setTimeout(() => {
      if (state.activeEvent >= events.length - 1) {
        updateTimelineProgress(1);
        stopPlayback();
        return;
      }
      setActiveEvent(state.activeEvent + 1, nextBoundary);
      scheduleNextEvent();
    }, duration);
  }

  function play(reset = false) {
    const events = state.stories[state.index].events || [];
    if (!events.length) return;
    if (reset || state.timelineProgress >= 0.999) {
      state.intro = true;
      document.querySelector(".run-story")?.classList.add("is-intro");
      setActiveEvent(0, 0);
      const step = document.getElementById("theater-step");
      if (step) step.textContent = "INTRO";
      setIntroScene();
    }
    state.playing = true;
    updatePlaybackButton();
    playSceneAudio();
    scheduleNextEvent();
  }

  function togglePlayback() {
    if (state.playing) stopPlayback();
    else play(false);
  }

  function startRunVisual(story) {
    window.cancelAnimationFrame(state.animationFrame);
    const canvas = document.getElementById("run-canvas");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const player = canvas.closest(".cinema-player");
    const events = story.events || [];
    const tools = [story.model_family, story.runtime, ...(story.agent_tools || [])].filter(Boolean);
    let seed = Array.from(String(story.id || story.title)).reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const signalField = Array.from({ length: 48 }, () => ({
      x: random(),
      y: random(),
      radius: 0.7 + random() * 1.6,
      phase: random() * Math.PI * 2,
      link: Math.floor(random() * 47)
    }));
    let lastFrame = 0;
    let firstFrame = 0;
    let focusX = 0;
    let focusY = 0;

    function eventPoint(index, width, height, compact) {
      const denominator = Math.max(events.length - 1, 1);
      const progress = index / denominator;
      return {
        x: width * ((compact ? 0.55 : 0.5) + (compact ? 0.36 : 0.42) * progress),
        y: height * (0.74 - (0.43 * progress) + Math.sin((index + 1) * 1.73) * (compact ? 0.055 : 0.07))
      };
    }

    function pathPosition(progress, width, height, compact) {
      if (!events.length) return { x: width * 0.72, y: height * 0.5 };
      const scaled = Math.min(Math.max(progress, 0), 0.9999) * events.length;
      const index = Math.min(Math.floor(scaled), events.length - 1);
      const nextIndex = Math.min(index + 1, events.length - 1);
      const local = scaled - index;
      const start = eventPoint(index, width, height, compact);
      const end = eventPoint(nextIndex, width, height, compact);
      return { x: start.x + (end.x - start.x) * local, y: start.y + (end.y - start.y) * local };
    }

    function draw(time) {
      if (document.hidden || time - lastFrame < 34) {
        state.animationFrame = window.requestAnimationFrame(draw);
        return;
      }
      lastFrame = time;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(Math.round(rect.width), 1);
      const height = Math.max(Math.round(rect.height), 1);
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const compact = width < 760;
      const event = (story.events || [])[state.activeEvent] || { type: "observation" };
      const color = eventColors[event.type] || eventColors.observation;
      const pulse = reduceMotion.matches ? 0 : Math.sin(time / 420);
      if (!firstFrame) firstFrame = time;
      const reveal = reduceMotion.matches ? 1 : Math.min((time - firstFrame) / 1500, 1);
      const target = pathPosition(state.timelineProgress, width, height, compact);
      if (!focusX && !focusY) { focusX = target.x; focusY = target.y; }
      focusX += (target.x - focusX) * 0.045;
      focusY += (target.y - focusY) * 0.045;
      const cameraX = ((width * (compact ? 0.72 : 0.76)) - focusX) * 0.1;
      const cameraY = ((height * 0.5) - focusY) * 0.08;
      const exploring = player?.classList.contains("is-exploring") || player?.classList.contains("is-depth-pinned");

      signalField.forEach((signal, index) => {
        const x = signal.x * width + cameraX * 0.35;
        const y = signal.y * height + cameraY * 0.35;
        const linked = signalField[signal.link];
        const linkX = linked.x * width + cameraX * 0.35;
        const linkY = linked.y * height + cameraY * 0.35;
        const alpha = (0.05 + (Math.sin(time / 900 + signal.phase) + 1) * 0.025) * reveal;
        context.globalAlpha = alpha;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(linkX, linkY);
        context.strokeStyle = index % 4 === 0 ? color : "#6f7782";
        context.lineWidth = 0.65;
        context.stroke();
        context.beginPath();
        context.arc(x, y, signal.radius, 0, Math.PI * 2);
        context.fillStyle = index % 5 === 0 ? color : "#707780";
        context.fill();
        if (exploring && state.depthCurrentX && Math.hypot(x - state.depthCurrentX, y - state.depthCurrentY) < width * 0.18) {
          context.globalAlpha = 0.14;
          context.beginPath();
          context.moveTo(state.depthCurrentX, state.depthCurrentY);
          context.lineTo(x, y);
          context.strokeStyle = color;
          context.lineWidth = 0.8;
          context.stroke();
        }
      });

      const points = events.map((_, index) => {
        const point = eventPoint(index, width, height, compact);
        return { x: point.x + cameraX, y: point.y + cameraY };
      });
      points.forEach((point, index) => {
        if (index >= points.length - 1) return;
        const nextPoint = points[index + 1];
        context.globalAlpha = (index < state.activeEvent ? 0.52 : 0.14) * reveal;
        context.beginPath();
        context.moveTo(point.x, point.y);
        const bend = (index % 2 ? -1 : 1) * height * 0.045;
        context.bezierCurveTo(
          point.x + (nextPoint.x - point.x) * 0.36, point.y + bend,
          point.x + (nextPoint.x - point.x) * 0.68, nextPoint.y - bend,
          nextPoint.x, nextPoint.y
        );
        context.strokeStyle = index < state.activeEvent ? color : "#87909a";
        context.lineWidth = index < state.activeEvent ? 1.7 : 0.8;
        context.stroke();
      });

      points.forEach((point, index) => {
        const complete = index < state.activeEvent;
        const active = index === state.activeEvent;
        context.globalAlpha = (active ? 0.96 : complete ? 0.58 : 0.24) * reveal;
        if (active) {
          context.beginPath();
          context.arc(point.x, point.y, 17 + pulse * 3, 0, Math.PI * 2);
          context.strokeStyle = color;
          context.lineWidth = 1;
          context.stroke();
          context.beginPath();
          context.arc(point.x, point.y, 28 + pulse * 5, 0, Math.PI * 2);
          context.strokeStyle = color;
          context.lineWidth = 0.6;
          context.stroke();
        }
        context.beginPath();
        context.arc(point.x, point.y, active ? 6 : complete ? 4 : 3, 0, Math.PI * 2);
        context.fillStyle = active || complete ? color : "#737b84";
        context.fill();
      });

      const activePoint = points[state.activeEvent] || target;
      const visibleTools = tools.slice(0, compact ? 2 : 4);
      visibleTools.forEach((label, index) => {
        const angle = (-Math.PI / 2) + (index - (visibleTools.length - 1) / 2) * 0.72;
        const radius = Math.min(width * 0.1, 112);
        const x = activePoint.x + Math.cos(angle) * radius;
        const y = activePoint.y + Math.sin(angle) * radius;
        context.globalAlpha = (0.3 + index * 0.08) * reveal;
        context.beginPath();
        context.moveTo(activePoint.x, activePoint.y);
        context.lineTo(x, y);
        context.strokeStyle = color;
        context.lineWidth = 0.7;
        context.stroke();
        context.beginPath();
        context.arc(x, y, 2.3, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        context.font = "600 9px -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui";
        context.fillStyle = "#333840";
        context.textAlign = "center";
        context.fillText(String(label).slice(0, 16), x, y - 7);
      });

      if (state.timelineProgress > 0 && points.length > 1) {
        for (let index = 0; index < 7; index += 1) {
          const particleProgress = ((time / 2600) + index / 7) % 1 * state.timelineProgress;
          const particle = pathPosition(particleProgress, width, height, compact);
          context.globalAlpha = 0.28 + index * 0.055;
          context.beginPath();
          context.arc(particle.x + cameraX, particle.y + cameraY, 1.4 + index * 0.12, 0, Math.PI * 2);
          context.fillStyle = color;
          context.fill();
        }
      }

      context.globalAlpha = 1;
      state.animationFrame = window.requestAnimationFrame(draw);
    }
    state.animationFrame = window.requestAnimationFrame(draw);
  }

  function animateDepthPointer(player) {
    window.cancelAnimationFrame(state.depthPointerFrame);
    function frame() {
      state.depthCurrentX += (state.depthTargetX - state.depthCurrentX) * 0.16;
      state.depthCurrentY += (state.depthTargetY - state.depthCurrentY) * 0.16;
      player.style.setProperty("--depth-x", `${state.depthCurrentX}px`);
      player.style.setProperty("--depth-y", `${state.depthCurrentY}px`);
      const panel = document.getElementById("depth-panel");
      if (panel) {
        const panelWidth = panel.offsetWidth || Math.min(player.clientWidth * 0.34, 360);
        const panelHeight = panel.offsetHeight || player.clientHeight * 0.45;
        const gap = player.clientWidth < 760 ? 18 : 28;
        const nextX = state.depthCurrentX > player.clientWidth * 0.56
          ? state.depthCurrentX - panelWidth - gap
          : state.depthCurrentX + gap;
        const nextY = state.depthCurrentY - panelHeight * 0.5;
        player.style.setProperty("--panel-x", `${Math.min(Math.max(nextX, 12), player.clientWidth - panelWidth - 12)}px`);
        player.style.setProperty("--panel-y", `${Math.min(Math.max(nextY, 52), player.clientHeight - panelHeight - 42)}px`);
      }
      if (Math.abs(state.depthTargetX - state.depthCurrentX) > 0.2 || Math.abs(state.depthTargetY - state.depthCurrentY) > 0.2) {
        state.depthPointerFrame = window.requestAnimationFrame(frame);
      }
    }
    state.depthPointerFrame = window.requestAnimationFrame(frame);
  }

  function depthModeFromPoint(x, y, width, height) {
    const left = x < width * 0.5;
    const top = y < height * 0.5;
    if (top && left) return "trigger";
    if (top) return "interpretation";
    if (left) return "proof";
    return "consequence";
  }

  function bindDepthInteraction() {
    const player = document.querySelector(".cinema-player");
    const toggle = document.getElementById("depth-toggle");
    if (!player || !toggle) return;
    const moveDepth = (event) => {
      const rect = player.getBoundingClientRect();
      state.depthTargetX = Math.min(Math.max(event.clientX - rect.left, 16), rect.width - 16);
      state.depthTargetY = Math.min(Math.max(event.clientY - rect.top, 16), rect.height - 16);
      const mode = depthModeFromPoint(state.depthTargetX, state.depthTargetY, rect.width, rect.height);
      if (mode !== state.depthMode) updateDepthPanel(state.stories[state.index], state.activeEvent, mode);
      if (!state.depthCurrentX && !state.depthCurrentY) {
        state.depthCurrentX = state.depthTargetX;
        state.depthCurrentY = state.depthTargetY;
      }
      animateDepthPointer(player);
    };
    player.addEventListener("pointerenter", (event) => {
      if (state.depthPinned) moveDepth(event);
    });
    player.addEventListener("pointermove", (event) => {
      if (state.depthPinned) moveDepth(event);
    });
    player.addEventListener("pointerleave", () => {});
    document.querySelectorAll("[data-depth-zone]").forEach((zone) => {
      const selectZone = () => updateDepthPanel(state.stories[state.index], state.activeEvent, zone.dataset.depthZone);
      zone.addEventListener("pointerenter", selectZone);
      zone.addEventListener("click", (event) => {
        event.stopPropagation();
        selectZone();
        state.depthPinned = true;
        player.classList.add("is-depth-pinned", "is-exploring");
        toggle.setAttribute("aria-pressed", "true");
        toggle.textContent = "Close";
      });
    });
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      state.depthPinned = !state.depthPinned;
      if (state.depthPinned) {
        const rect = player.getBoundingClientRect();
        state.depthTargetX = rect.width * 0.58;
        state.depthTargetY = rect.height * 0.46;
        state.depthCurrentX = state.depthTargetX;
        state.depthCurrentY = state.depthTargetY;
        updateDepthPanel(state.stories[state.index], state.activeEvent, "interpretation");
        animateDepthPointer(player);
      }
      player.classList.toggle("is-depth-pinned", state.depthPinned);
      player.classList.toggle("is-exploring", state.depthPinned);
      toggle.setAttribute("aria-pressed", String(state.depthPinned));
      toggle.textContent = state.depthPinned ? "Close" : "Inspect";
    });
  }

  function bindStoryControls() {
    document.getElementById("open-evidence")?.addEventListener("click", openEvidence);
    document.getElementById("share-story")?.addEventListener("click", () => shareStory().catch(() => {}));
    document.getElementById("toggle-playback")?.addEventListener("click", togglePlayback);
    document.getElementById("restart-playback")?.addEventListener("click", () => play(true));
    document.getElementById("toggle-audio")?.addEventListener("click", toggleAudio);
    document.querySelectorAll("[data-presentation-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const story = state.stories[state.index];
        const preset = button.dataset.presentationChoice;
        if (!presentationPresets[preset] || story.presentation.preset === preset) return;
        story.presentation = normalizePresentation({
          ...story.presentation,
          preset,
          theme: presentationPresets[preset].theme
        }, story);
        const article = document.querySelector(".run-story");
        article.dataset.presentation = preset;
        article.setAttribute("style", presentationStyle(story));
        document.querySelectorAll("[data-presentation-choice]").forEach((choice) => {
          const active = choice.dataset.presentationChoice === preset;
          choice.classList.toggle("is-active", active);
          choice.setAttribute("aria-pressed", String(active));
        });
        setActiveEvent(state.activeEvent, state.timelineProgress);
      });
    });
    bindDepthInteraction();
    const scrubInput = document.getElementById("story-scrub-input");
    const scrubTrack = scrubInput?.closest(".chapter-track");
    const beginScrub = () => {
      state.scrubbing = true;
      scrubTrack?.classList.add("is-scrubbing");
      stopPlayback();
    };
    const scrub = () => {
      if (!scrubInput) return;
      if (!state.scrubbing) beginScrub();
      state.intro = false;
      document.querySelector(".run-story")?.classList.remove("is-intro");
      const events = state.stories[state.index].events || [];
      const scrubProgress = Number(scrubInput.value) / 1000;
      const eventIndex = Math.min(events.length - 1, Math.floor(scrubProgress * events.length));
      if (eventIndex !== state.activeEvent) setActiveEvent(eventIndex, scrubProgress);
      else updateTimelineProgress(scrubProgress);
    };
    const finishScrub = () => {
      state.scrubbing = false;
      scrubTrack?.classList.remove("is-scrubbing");
    };
    scrubInput?.addEventListener("pointerdown", beginScrub);
    scrubInput?.addEventListener("pointermove", (event) => {
      scrubTrack?.style.setProperty("--scrub-hover", `${event.offsetX}px`);
    });
    scrubInput?.addEventListener("pointerleave", () => {
      if (!state.scrubbing) scrubTrack?.style.removeProperty("--scrub-hover");
    });
    scrubInput?.addEventListener("input", scrub);
    scrubInput?.addEventListener("pointerup", finishScrub);
    scrubInput?.addEventListener("pointercancel", finishScrub);
    scrubInput?.addEventListener("change", finishScrub);
    document.querySelectorAll(".chapter-marker").forEach((element) => {
      element.addEventListener("click", () => {
        stopPlayback();
        state.intro = false;
        document.querySelector(".run-story")?.classList.remove("is-intro");
        const eventIndex = Number(element.dataset.eventIndex);
        const events = state.stories[state.index].events || [];
        setActiveEvent(eventIndex, eventIndex / events.length);
      });
    });
  }

  function render() {
    const story = state.stories[state.index];
    if (!story) return;
    stopPlayback();
    window.cancelAnimationFrame(state.animationFrame);
    window.cancelAnimationFrame(state.depthPointerFrame);
    state.shotAnimation?.cancel();
    state.shotAnimation = null;
    state.activeEvent = 0;
    state.intro = true;
    state.timelineProgress = 0;
    state.depthPinned = false;
    state.depthMode = "interpretation";
    state.depthCurrentX = 0;
    state.depthCurrentY = 0;
    stage.innerHTML = storyMarkup(story);
    stage.setAttribute("aria-busy", "false");
    position.textContent = `${state.index + 1} / ${state.stories.length}`;
    previousButton.disabled = state.index === 0;
    nextButton.disabled = state.index === state.stories.length - 1;
    progress.style.setProperty("--progress", `${((state.index + 1) / state.stories.length) * 100}%`);
    document.title = `${story.title} - SunfishLoop`;
    const sharePath = story.is_demo ? `/stories?demo=${encodeURIComponent(story.id)}` : (story.story_url || `/stories/${story.id}`);
    if (!studioMode && !embedMode && `${location.pathname}${location.search}` !== sharePath) history.replaceState({ storyId: story.id }, "", sharePath);
    bindStoryControls();
    updateAudioButton();
    setActiveEvent(0, 0);
    const introStep = document.getElementById("theater-step");
    if (introStep) introStep.textContent = "INTRO";
    setIntroScene();
    startRunVisual(story);
    if (!reduceMotion.matches && (story.events || []).length > 1) {
      state.playTimer = window.setTimeout(() => play(false), 900);
    }
  }

  function move(delta) {
    const next = Math.min(Math.max(state.index + delta, 0), state.stories.length - 1);
    if (next === state.index) return;
    state.index = next;
    render();
  }

  async function load() {
    if (studioMode) {
      const response = await fetch("/examples/story-manifest-v0.1.json?v=1");
      if (!response.ok) throw new Error("Preview manifest unavailable");
      state.stories = [normalizeStory(await response.json())];
      render();
      return;
    }
    const storyMatch = location.pathname.match(/^\/stories\/([^/]+)$/);
    if (storyMatch) {
      const response = await fetch(`/api/stories/${encodeURIComponent(storyMatch[1])}`);
      if (response.ok) {
        state.stories = [normalizeStory(await response.json())];
        render();
        return;
      }
    }
    const response = await fetch("/api/stories?limit=20");
    if (response.ok) {
      const payload = await response.json();
      state.stories = Array.isArray(payload.items) ? payload.items.map(normalizeStory) : [];
    }
    if (!state.stories.length) {
      const [manifestResponse, demoResponse] = await Promise.all([
        fetch("/examples/story-manifest-v0.1.json?v=1"),
        fetch("/stories-demo.json?v=3")
      ]);
      const demo = await demoResponse.json();
      const legacyStories = (demo.items || []).map(normalizeStory);
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        const manifestStory = normalizeStory({ ...manifest, is_demo: true });
        state.stories = [manifestStory, ...legacyStories.filter((story) => story.id !== manifestStory.id)];
      } else {
        state.stories = legacyStories;
      }
    }
    if (!state.stories.length) throw new Error("No run stories available");
    const requestedDemo = new URLSearchParams(location.search).get("demo");
    const requestedIndex = state.stories.findIndex((story) => story.id === requestedDemo);
    if (requestedIndex >= 0) state.index = requestedIndex;
    render();
  }

  previousButton.addEventListener("click", () => move(-1));
  nextButton.addEventListener("click", () => move(1));
  closeEvidenceButton.addEventListener("click", closeEvidence);
  backdrop.addEventListener("click", closeEvidence);
  window.addEventListener("keydown", (event) => {
    if (embedMode && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      parent.postMessage({ type: "sunfish:slot-nav", direction: event.key === "ArrowDown" ? "next" : "previous" }, location.origin);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") move(1);
    if (event.key === " ") {
      event.preventDefault();
      togglePlayback();
    }
    if (event.key === "Escape") closeEvidence();
  });
  let embedNavAt = 0;
  let embedTouchY = null;
  function requestSlotNavigation(direction) {
    const now = Date.now();
    if (!embedMode || now - embedNavAt < 650) return;
    embedNavAt = now;
    parent.postMessage({ type: "sunfish:slot-nav", direction }, location.origin);
  }
  window.addEventListener("wheel", (event) => {
    if (!embedMode || Math.abs(event.deltaY) < 12) return;
    event.preventDefault();
    requestSlotNavigation(event.deltaY > 0 ? "next" : "previous");
  }, { passive: false });
  window.addEventListener("touchstart", (event) => {
    if (embedMode && event.touches.length === 1) embedTouchY = event.touches[0].clientY;
  }, { passive: true });
  window.addEventListener("touchend", (event) => {
    if (!embedMode || embedTouchY === null || !event.changedTouches[0]) return;
    const delta = embedTouchY - event.changedTouches[0].clientY;
    embedTouchY = null;
    if (Math.abs(delta) >= 48) requestSlotNavigation(delta > 0 ? "next" : "previous");
  }, { passive: true });
  window.addEventListener("pointerdown", () => {
    if (state.audioEnabled && state.playing && document.body.classList.contains("audio-awaiting-gesture")) {
      playSceneAudio();
    }
  }, { capture: true });
  window.addEventListener("message", (event) => {
    if (!studioMode || event.origin !== location.origin || event.data?.type !== "sunfish:preview") return;
    try {
      state.stories = [normalizeStory(event.data.manifest)];
      state.index = 0;
      render();
      event.source?.postMessage({ type: "sunfish:preview-ready", id: event.data.manifest?.id }, event.origin);
    } catch (error) {
      event.source?.postMessage({ type: "sunfish:preview-error", message: error.message }, event.origin);
    }
  });
  window.addEventListener("beforeunload", () => {
    window.clearTimeout(state.playTimer);
    window.cancelAnimationFrame(state.timelineFrame);
    window.cancelAnimationFrame(state.depthPointerFrame);
    window.cancelAnimationFrame(state.animationFrame);
    state.shotAnimation?.cancel();
  });
  load().then(() => {
    if (studioMode) window.parent.postMessage({ type: "sunfish:studio-ready" }, location.origin);
  }).catch((error) => {
    stage.innerHTML = `<div class="story-loading"><p>${escapeHtml(error.message)}</p></div>`;
    stage.setAttribute("aria-busy", "false");
  });
})();
