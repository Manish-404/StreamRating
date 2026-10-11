import { useEffect, useState } from 'preact/hooks';
import type { MediaType } from '../db/types';
import { MATCH_THRESHOLD } from '../match/constants';
import type { RatingsStatus, TitleInfo } from '../match/types';
import { sendMessage } from '../messaging/protocol';
import type { LatestReview, ReviewResult } from '../services/reviews';
import { formatRuntime, formatVotes, outOfTenTone, percentTone } from './format';

const STATUS_NOTE: Partial<Record<RatingsStatus, string>> = {
  missing_key: 'Add an OMDb key in the StreamRating settings to see IMDb and Rotten Tomatoes scores.',
  quota: 'The OMDb daily limit is used up. IMDb and Rotten Tomatoes scores come back tomorrow.',
  no_imdb_id: 'No IMDb entry was found for this title.',
  unavailable: 'IMDb and Rotten Tomatoes scores are not available right now.',
};

function Score({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div class={'score ' + tone}>
      <div class="score-value">{value}</div>
      <div class="score-label">{label}</div>
      {sub && <div class="score-sub">{sub}</div>}
    </div>
  );
}

export function Review({ result, heading = 'Latest review' }: { result: ReviewResult | 'loading'; heading?: string }) {
  if (result === 'loading') return <p class="review-note">Loading latest review&hellip;</p>;
  if (result.status !== 'ok') return result.status === 'none' ? <p class="review-note">No user reviews yet.</p> : null;
  const r: LatestReview = result.review;
  const date = new Date(r.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <div class="review">
      <div class="review-head">
        <b>{heading}</b>
        <span>
          {r.author}
          {r.rating !== null ? ' · ' + r.rating + '/10' : ''} {'·'} {date}
        </span>
      </div>
      <p class="review-text">
        &ldquo;{r.text}
        {r.truncated ? '…' : ''}&rdquo;
      </p>
      <div class="review-foot">
        <span>May contain spoilers. {r.total} user {r.total === 1 ? 'review' : 'reviews'} on TMDB.</span>
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer">
            Read in full
          </a>
        )}
      </div>
    </div>
  );
}

/** The newest user review of a title, loaded when the card opens. */
export function useLatestReview(type: MediaType, tmdbId: number): ReviewResult | 'loading' {
  const [review, setReview] = useState<ReviewResult | 'loading'>('loading');
  useEffect(() => {
    setReview('loading');
    let live = true;
    sendMessage('getLatestReview', { type, tmdbId })
      .then((r) => live && setReview(r ?? { status: 'error' }))
      .catch(() => live && setReview({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [type, tmdbId]);
  return review;
}

export interface HoverCardProps {
  info: TitleInfo;
  onEnter?: () => void;
  onLeave?: () => void;
}

export function HoverCard({ info, onEnter, onLeave }: HoverCardProps) {
  const [poster, setPoster] = useState<string | null>(null);
  const review = useLatestReview(info.type, info.tmdbId);

  useEffect(() => {
    setPoster(null);
    if (!info.posterPath) return;
    let live = true;
    sendMessage('getPoster', info.posterPath)
      .then((url) => live && setPoster(url))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [info.posterPath]);

  const meta = [info.year, info.type === 'tv' && info.seasons ? info.seasons + (info.seasons === 1 ? ' season' : ' seasons') : formatRuntime(info.runtimeMin), info.genres.slice(0, 3).join(', ')]
    .filter(Boolean)
    .join(' · ');
  const note = info.confidence < MATCH_THRESHOLD ? 'Not sure this is the right title. Showing the closest match.' : STATUS_NOTE[info.ratingsStatus];
  const people = info.type === 'tv' ? 'Created by' : 'Directed by';

  return (
    <div class="card" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div class="card-top">
        <div class="poster">{poster && <img src={poster} alt="" />}</div>
        <div class="card-head">
          <h3>{info.title}</h3>
          <div class="meta">{meta}</div>
          <div class="scores">
            {info.imdbRating !== null && (
              <Score label="IMDb" value={info.imdbRating.toFixed(1)} tone={outOfTenTone(info.imdbRating)} sub={formatVotes(info.imdbVotes)} />
            )}
            {info.rtCritics !== null && <Score label="Tomatometer" value={info.rtCritics + '%'} tone={percentTone(info.rtCritics)} />}
            {info.metacritic !== null && <Score label="Metacritic" value={String(info.metacritic)} tone={percentTone(info.metacritic)} />}
            {info.tmdbRating !== null && <Score label="TMDB" value={info.tmdbRating.toFixed(1)} tone="plain" sub={formatVotes(info.tmdbVotes)} />}
          </div>
        </div>
      </div>
      {info.tagline && <p class="tagline">{info.tagline}</p>}
      {info.overview && <p class="overview">{info.overview}</p>}
      {info.directors.length > 0 && <p class="people"><b>{people}</b> {info.directors.slice(0, 2).join(', ')}</p>}
      {info.cast.length > 0 && <p class="people"><b>Cast</b> {info.cast.join(', ')}</p>}
      <Review result={review} />
      {note && <p class="note">{note}</p>}
      {info.imdbId && (
        <a class="link" href={'https://www.imdb.com/title/' + info.imdbId + '/'} target="_blank" rel="noreferrer">
          Open on IMDb
        </a>
      )}
    </div>
  );
}
