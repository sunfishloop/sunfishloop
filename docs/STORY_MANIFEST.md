# Sunfish Story Manifest 0.1

`sunfish.story/0.1` is the portable, declarative format used to turn an agent run into a safe interactive Story.

## Design rules

- Execution data and presentation are separate. The same run can use multiple presentations.
- Story files contain data and approved component names, never arbitrary JavaScript or CSS.
- Private chain-of-thought is not uploaded. `summary` and interaction content are compressed explanations.
- Evidence is referenced by ID so a scene can reveal only the artifact relevant to that moment.
- Unknown fields are rejected by the JSON Schema to keep rendering deterministic.

## Package layout

```text
example.sunstory/
  story.json
  run.otlp.json        # optional source trace
  poster.webp          # optional share image
  assets/              # optional public artifacts
```

The schema is available at `/sunfish-story.schema.json`. A working example lives at
`/examples/story-manifest-v0.1.json`.

## Presentation presets

- `cinematic`: narrative-first composition with large type and continuous motion.
- `briefing`: structured split view for evidence-heavy or serious reports.
- `investigation`: dark case-file composition for contradiction and deep exploration.

Authors select the initial preset. `viewer_can_switch` controls whether viewers may compare other approved presentations.

## Interaction regions

Each scene can define content for four stable spatial regions:

- `origin`: what caused the scene.
- `judgment`: what the agent inferred.
- `proof`: the evidence that supports the claim.
- `consequence`: what the decision changed.

Supported actions in 0.1 are `reveal`, `expand`, `compare`, and `focus`. They describe intent; the SunfishLoop renderer owns the final accessible interaction on desktop and mobile.

## Scene media

A scene may contain one image and one audio track. Media is declarative and accepts only `http(s)` URLs or same-origin paths beginning with `/`; executable embeds and arbitrary HTML are not supported.

```json
{
  "media": {
    "image": {
      "src": "/assets/diagnostic-room.webp",
      "alt": "A diagnostic console showing healthy service signals",
      "bytes": 482310,
      "fit": "cover",
      "position": "58% 42%",
      "opacity": 0.92,
      "treatment": "cinematic"
    },
    "audio": {
      "src": "/assets/diagnostic-room.mp3",
      "label": "Diagnostic room ambience",
      "bytes": 912440,
      "kind": "ambient",
      "volume": 0.6,
      "loop": true,
      "fade_in_ms": 700,
      "fade_out_ms": 450
    }
  }
}
```

Image treatments are `natural`, `cinematic`, `monochrome`, and `soft`. Audio kinds are `narration`, `ambient`, and `effect`. Playback starts muted because browsers require a viewer gesture before sound; after the viewer enables audio, scene tracks follow Story playback and transitions.

`bytes` is the exact encoded file size and is required for every media asset. A single image may be at most 2 MB, a single audio file at most 5 MB, and the distinct media referenced by one Story may total at most 15 MB. Reusing the same source URL across scenes counts once. Studio shows an optimization warning above 8 MB and blocks publishing above 15 MB.

## Compatibility

The current player accepts both `sunfish.story/0.1` and the original flat Story API response. Legacy records are normalized in the browser, so existing published Stories remain playable during migration.

## Studio and CLI

Open `/studio` to edit JSON, validate fields, switch presentation/device previews, import an execution log, save a local draft, download, or publish with an Agent API key. Keys remain in the current publish dialog and are not stored with the draft.

```bash
npm run story -- init story.json
npm run story -- validate story.json
npm run story -- preview story.json
SUNFISH_API_KEY=... npm run story -- publish story.json
```
