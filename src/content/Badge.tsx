import { MATCH_THRESHOLD } from '../match/constants';
import type { TitleInfo } from '../match/types';
import { outOfTenTone, percentTone } from './format';
import type { BadgeState } from './state';

export interface BadgeProps {
  state: BadgeState;
  onEnter: (el: HTMLElement, info: TitleInfo, at: { x: number; y: number }) => void;
  onLeave: () => void;
  onSetup: () => void;
}

export function Chips({ info }: { info: TitleInfo }) {
  const chips = [];
  if (info.imdbRating !== null) {
    chips.push(
      <span key="imdb" class={'chip ' + outOfTenTone(info.imdbRating)}>
        <b>IMDb</b> {info.imdbRating.toFixed(1)}
      </span>,
    );
  }
  if (info.rtCritics !== null) {
    chips.push(
      <span key="rt" class={'chip ' + percentTone(info.rtCritics)}>
        <b>RT</b> {info.rtCritics}%
      </span>,
    );
  }
  if (chips.length === 0 && info.tmdbRating !== null) {
    chips.push(
      <span key="tmdb" class={'chip ' + outOfTenTone(info.tmdbRating)} title="IMDb and Rotten Tomatoes scores are not available, so this is the TMDB score.">
        <b>TMDB</b> {info.tmdbRating.toFixed(1)}
      </span>,
    );
  }
  if (chips.length === 0) chips.push(<span key="none" class="chip dim">No rating</span>);
  return <>{chips}</>;
}

export function Badge({ state, onEnter, onLeave, onSetup }: BadgeProps) {
  if (state.status === 'none') return null;
  if (state.status === 'unlisted') {
    return (
      <span class="badge">
        <span class="chip dim" title="Not found on TMDB or IMDb. This may be a dub sold under a new name, a compilation, or not a film.">
          No listing
        </span>
      </span>
    );
  }
  if (state.status === 'loading') return <span class="badge"><span class="chip dim">...</span></span>;

  if (state.status === 'error') {
    if (state.kind === 'missing_key') {
      return (
        <span class="badge">
          <button
            class="chip setup"
            onClick={(e) => {
              // The thumbnail is itself a link; this click should open settings, not the title.
              e.preventDefault();
              e.stopPropagation();
              onSetup();
            }} title="StreamRating needs a free TMDB key. Click to open settings.">
            Set up StreamRating
          </button>
        </span>
      );
    }
    return (
      <span class="badge">
        <span class="chip dim" title={state.message}>!</span>
      </span>
    );
  }

  const { info } = state;
  const sure = info.confidence >= MATCH_THRESHOLD;
  return (
    <span class="badge" onMouseEnter={(e) => onEnter(e.currentTarget, info, { x: e.clientX, y: e.clientY })} onMouseLeave={onLeave}>
      {sure ? <Chips info={info} /> : <span class="chip dim" title={'Not sure this is "' + info.title + '". Hover for details.'}>?</span>}
    </span>
  );
}
