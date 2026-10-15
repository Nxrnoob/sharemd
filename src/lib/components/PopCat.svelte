<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * Outline cat that swaps between a closed muzzle and a wide-open "pop".
   *
   * Ported from the original Svelte 4 source. The art, path data and tuning
   * are unchanged — only prop declarations and event/style syntax were
   * modernised for Svelte 5. Kept fully interactive (pointer + keyboard)
   * so it still works as a standalone button; inside the drag ghost it is
   * wrapped in an `inert` container, which removes it from the a11y tree and
   * the tab order without needing a separate non-interactive variant.
   */
  interface Props {
    size?: number;
    strokeWidth?: number;
    /** Loop the mouth open/closed on an interval instead of waiting for input. */
    autoPlay?: boolean;
    /** Half-cycle in ms; a full open+close is 2x this. */
    interval?: number;
    sound?: boolean;
  }

  let { size = 130, strokeWidth = 10, autoPlay = false, interval = 220, sound = true }: Props =
    $props();

  let isOpen = $state(false);
  let count = $state(0);
  let audioCtx: AudioContext | undefined;

  function playPop() {
    if (!sound || typeof window === 'undefined') return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx = audioCtx ?? new Ctor();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(720, now + 0.06);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.065);
    } catch {}
  }

  function openMouth() {
    if (!isOpen) {
      isOpen = true;
      count += 1;
      playPop();
    }
  }

  function closeMouth() {
    isOpen = false;
  }

  onMount(() => {
    if (!autoPlay) return;
    // Toggles state directly rather than via openMouth(), so the autoplay
    // loop stays silent — the pop is reserved for an actual press.
    const id = setInterval(() => (isOpen = !isOpen), interval);
    return () => clearInterval(id);
  });
</script>

<button
  type="button"
  class="popcat-outline-btn"
  onpointerdown={openMouth}
  onpointerup={closeMouth}
  onpointerleave={closeMouth}
  onkeydown={(e) => (e.key === ' ' || e.key === 'Enter') && openMouth()}
  onkeyup={(e) => (e.key === ' ' || e.key === 'Enter') && closeMouth()}
  style:width="{size}px"
  style:height="{size}px"
  aria-label="Pop Cat Outline Toggle"
>
  <svg
    viewBox="0 0 500 500"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="popcat-svg"
  >
    {#if !isOpen}
      <!-- ==================== FRAME 10: WIDER FACE + HIGHER LEFT PATCH ==================== -->

      <!-- 1. Lighter Taupe Forehead & Left Ear Cap Shading (Widened to match new head width) -->
      <path
        d="M 118 214
           C 100 184, 84 146, 72 104
           C 66 82, 76 68, 98 76
           C 124 86, 162 110, 196 134
           C 226 120, 260 114, 290 118
           C 254 134, 224 152, 204 176
           C 178 164, 148 182, 118 214 Z"
        fill="currentColor"
        fill-opacity="0.14"
      />

      <!-- 2. Iconic Dark Sideburn/Cheek Patch (Moved HIGHER & FURTHER LEFT with wider cheek gap) -->
      <path
        d="M 118 214
           C 138 184, 168 164, 194 172
           C 202 175, 198 192, 188 210
           C 176 232, 174 260, 168 282
           C 160 298, 140 296, 128 278
           C 116 258, 112 234, 118 214 Z"
        fill="currentColor"
        fill-opacity="0.65"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.75}
        stroke-linejoin="round"
      />

      <!-- 3. Continuous Fur-Cap Boundary Line (Forehead to top of sideburn patch) -->
      <path
        d="M 284 119
           C 250 134, 218 150, 194 172"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.7}
        stroke-linecap="round"
        opacity="0.75"
      />

      <!-- 4. Widened Outer Silhouette (Wider left cheek indent + fuller right cheek bulge) -->
      <path
        d="M 62 490
           C 80 426, 114 374, 138 312
           C 122 284, 112 246, 118 214
           C 100 184, 84 146, 72 104
           C 66 82, 76 68, 98 76
           C 124 86, 162 110, 196 134
           C 228 120, 272 114, 308 120
           L 348 80
           C 364 66, 382 72, 384 96
           L 380 154
           C 412 176, 426 204, 420 234
           C 412 264, 390 278, 380 302
           C 374 336, 384 418, 392 490"
        stroke="currentColor"
        stroke-width={strokeWidth}
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- 5. Inner Left Ear Pinna Line -->
      <path
        d="M 126 196 C 108 160, 96 128, 94 102 C 116 112, 144 132, 170 152"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.75}
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- 6. Inner Right Ear Line -->
      <path
        d="M 328 122 L 354 96 C 360 90, 366 94, 366 106 L 362 144"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.65}
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.75"
      />

      <!-- 7. Left Eye (Spaced nicely with room between eye and left patch) -->
      <ellipse
        cx="252"
        cy="168"
        rx="23"
        ry="13"
        transform="rotate(-10 252 168)"
        fill="currentColor"
      />

      <!-- 8. Right Eye -->
      <ellipse
        cx="348"
        cy="158"
        rx="16"
        ry="17"
        transform="rotate(-5 348 158)"
        fill="currentColor"
      />

      <!-- 9. Subtle Nose Indentation -->
      <path
        d="M 308 186 Q 322 194 335 184"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.8}
        stroke-linecap="round"
      />

      <!-- 10. EXACT SINGLE GENTLE CURVE MOUTH (Untouched curvature, centered in wider muzzle) -->
      <path
        d="M 258 224 Q 318 234 372 212"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.85}
        stroke-linecap="round"
      />
    {:else}
      <!-- ==================== FRAME 00: WIDER FACE + WIDE OPEN POP MOUTH ==================== -->

      <!-- 1. Lighter Taupe Forehead & Left Ear Cap Shading -->
      <path
        d="M 112 222
           C 94 192, 78 154, 66 110
           C 60 88, 70 74, 92 82
           C 118 92, 156 116, 190 140
           C 220 126, 254 120, 284 124
           C 248 140, 216 158, 194 184
           C 168 174, 140 190, 112 222 Z"
        fill="currentColor"
        fill-opacity="0.14"
      />

      <!-- 2. Iconic Dark Sideburn/Cheek Patch (Higher & further left, compressed slightly by open jaw) -->
      <path
        d="M 112 222
           C 130 192, 158 174, 182 180
           C 190 183, 186 200, 176 218
           C 164 240, 162 268, 156 290
           C 148 304, 130 302, 120 284
           C 108 264, 106 242, 112 222 Z"
        fill="currentColor"
        fill-opacity="0.65"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.75}
        stroke-linejoin="round"
      />

      <!-- 3. Continuous Fur-Cap Boundary Line -->
      <path
        d="M 278 125 C 244 140, 210 158, 182 180"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.7}
        stroke-linecap="round"
        opacity="0.75"
      />

      <!-- 4. Widened Outer Silhouette (Wide left cheek + wide right cheek around open mouth) -->
      <path
        d="M 58 490
           C 76 426, 112 378, 134 318
           C 118 290, 106 254, 112 222
           C 94 192, 78 154, 66 110
           C 60 88, 70 74, 92 82
           C 118 92, 156 116, 190 140
           C 222 126, 264 120, 300 124
           L 342 86
           C 358 72, 376 78, 378 102
           L 374 152
           C 410 174, 428 212, 424 254
           C 420 292, 398 318, 378 338
           C 372 374, 382 426, 390 490"
        stroke="currentColor"
        stroke-width={strokeWidth}
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- 5. Inner Left Ear Pinna Line -->
      <path
        d="M 118 202 C 100 166, 88 134, 88 108 C 110 118, 138 138, 164 158"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.75}
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- 6. Inner Right Ear Line -->
      <path
        d="M 324 126 L 348 102 C 354 96, 360 100, 360 112 L 356 144"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.65}
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.75"
      />

      <!-- 7. Squinted Left Eye -->
      <ellipse
        cx="232"
        cy="162"
        rx="21"
        ry="9"
        transform="rotate(-18 232 162)"
        fill="currentColor"
      />

      <!-- 8. Squinted Right Eye -->
      <ellipse
        cx="342"
        cy="146"
        rx="15.5"
        ry="8.5"
        transform="rotate(8 342 146)"
        fill="currentColor"
      />

      <!-- 9. Subtle Nose Bridge Bump Above Top Lip -->
      <path
        d="M 298 156 Q 314 151 326 156"
        stroke="currentColor"
        stroke-width={strokeWidth * 0.55}
        stroke-linecap="round"
        opacity="0.6"
      />

      <!-- 10. MASSIVE 'POP' MOUTH CAVITY (Expanded slightly for the wider face) -->
      <path
        d="M 204 256
           C 200 204, 254 166, 320 168
           C 382 170, 408 210, 400 262
           C 392 310, 336 332, 274 322
           C 220 314, 206 286, 204 256 Z"
        fill="currentColor"
        fill-opacity="0.25"
        stroke="currentColor"
        stroke-width={strokeWidth * 1.05}
        stroke-linejoin="round"
      />

      <!-- Deep Inner Mouth Core -->
      <path
        d="M 220 256
           C 216 214, 262 182, 320 184
           C 372 186, 392 218, 384 262
           C 376 300, 330 316, 276 308
           C 232 300, 222 278, 220 256 Z"
        fill="currentColor"
      />
    {/if}
  </svg>
</button>

<style>
  .popcat-outline-btn {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.06s ease-out;
  }

  .popcat-outline-btn:active {
    transform: scale(0.96);
  }

  .popcat-svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
</style>
