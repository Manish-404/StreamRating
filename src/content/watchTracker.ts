/** Played for this long, or this share of the runtime (whichever comes first), and a title counts as being watched. */
export const WATCH_MIN_SECONDS = 5 * 60;
export const WATCH_MIN_FRACTION = 0.15;
/** A trailer is only a weak signal, so it needs less: half a minute, or half of it if it is shorter than a minute (a teaser). */
export const TRAILER_MIN_SECONDS = 30;
export const TRAILER_MIN_FRACTION = 0.5;
/** Reached this far into the runtime (after really watching), it is finished. */
export const COMPLETE_FRACTION = 0.9;
/** Progress is saved again when it has moved by this much. */
const SAVE_EVERY = 0.05;
/**
 * The longest gap between two samples that is still playback. Sampled once a second, a video at twice the speed
 * moves 2 s; anything bigger is a seek, and a seek is not watching.
 */
const MAX_STEP_SECONDS = 4;

export interface Sample {
  /** `video.currentTime`. */
  position: number;
  /** `video.duration`; NaN or 0 until the video has loaded. */
  duration: number;
  /** Playing right now: not paused, not buffering, not showing an advert. */
  playing: boolean;
}

export interface WatchEvent {
  /** 0..1 of the runtime reached (the furthest point), not of the time played. */
  progress: number;
  complete: boolean;
}

/**
 * Turns a stream of playback samples into "this was watched" events. Only real playback time counts: pausing adds
 * nothing and jumping around adds nothing, so skipping to the end of a film does not make it watched.
 */
export function createWatchTracker(opts: { trailer?: boolean } = {}) {
  let last: Sample | null = null;
  let played = 0;
  let furthest = 0;
  let started = false;
  let completed = false;
  let saved = 0;

  return {
    /** Feed one sample. Returns an event when there is something to save, else null. */
    sample(s: Sample): WatchEvent | null {
      const usable = Number.isFinite(s.duration) && s.duration > 0;
      if (last && s.playing && last.playing) {
        const step = s.position - last.position;
        if (step > 0 && step <= MAX_STEP_SECONDS) played += step;
      }
      last = s;
      if (!usable) return null;
      if (s.playing) furthest = Math.max(furthest, Math.min(1, s.position / s.duration));

      const enough = opts.trailer
        ? played >= Math.min(TRAILER_MIN_SECONDS, s.duration * TRAILER_MIN_FRACTION)
        : played >= WATCH_MIN_SECONDS || played / s.duration >= WATCH_MIN_FRACTION;
      if (!enough) return null;

      const complete = furthest >= COMPLETE_FRACTION;
      if (!started || (complete && !completed) || furthest - saved >= SAVE_EVERY) {
        started = true;
        completed ||= complete;
        saved = furthest;
        return { progress: furthest, complete };
      }
      return null;
    },

    /** The last word, for when playback stops or the page changes: null if nothing new has happened since the last save. */
    flush(): WatchEvent | null {
      if (!started || furthest <= saved) return null;
      saved = furthest;
      return { progress: furthest, complete: furthest >= COMPLETE_FRACTION };
    },

    get played() {
      return played;
    },
  };
}

export type WatchTracker = ReturnType<typeof createWatchTracker>;
