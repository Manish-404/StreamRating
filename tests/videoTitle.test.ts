import { describe, expect, it } from 'vitest';
import { parseVideoTitle } from '../src/match/videoTitle';

const first = (t: string) => parseVideoTitle(t)?.candidates[0];

describe('parseVideoTitle', () => {
  it('reads the film name from full-movie uploads seen on YouTube', () => {
    expect(parseVideoTitle('Oppenheimer (2023) | HD Full Movie | Universal Studios')).toEqual({ candidates: ['Oppenheimer'], year: 2023, type: 'movie', people: [] });
    expect(parseVideoTitle('Oppenheimer: Full Movie Universal Pictures 2023')).toEqual({ candidates: ['Oppenheimer'], year: 2023, type: 'movie', people: [] });
    expect(first('Oppenheimer Full Movie Hindi Dubbed')).toBe('Oppenheimer');
    expect(first('Pushpa 2 The Rule Full Movie Hindi Dubbed | Allu Arjun, Rashmika | New South Movie 2024')).toBe('Pushpa 2 The Rule');
    expect(first('KGF Chapter 2 Full Movie In Hindi Dubbed | Yash | Sanjay Dutt | Srinidhi')).toBe('KGF Chapter 2');
    expect(first('Stree 2 Full Movie | Rajkummar Rao, Shraddha Kapoor')).toBe('Stree 2');
    expect(first('Interstellar 2014 (Full Movie)')).toBe('Interstellar');
    expect(parseVideoTitle('Interstellar 2014 (Full Movie)')?.year).toBe(2014);
  });

  it('finds the name next to the piece that says movie when the first piece is not it', () => {
    const r = parseVideoTitle('Uri: The Surgical Strike - Hindi Patriotic Full Movie - Vicky Kaushal, Yami Gautam, Paresh Rawal')!;
    expect(r.candidates).toEqual(['Uri: The Surgical Strike', 'Uri']);
    expect(r.type).toBe('movie');
    expect(parseVideoTitle("Don Lee's THE ROUNDUP | Hindi Dubbed Full Movie | Korean Action Blockbuster | IOF-Hindi")!.candidates).toEqual([
      "Don Lee's THE ROUNDUP",
      'THE ROUNDUP',
    ]);
    expect(parseVideoTitle('MISSION INTERSTELLAR - Hollywood Movie Hindi Dubbed | Blaine Gray, Rebecca | Sci-Fi Thriller Movie')!.candidates).toEqual([
      'MISSION INTERSTELLAR',
    ]);
    expect(parseVideoTitle('Shah Rukh Khan | Jawan | Official Trailer')!.candidates).toEqual(['Shah Rukh Khan', 'Jawan']);
  });

  it('reads trailers and teasers, without guessing the type', () => {
    expect(parseVideoTitle('OPPENHEIMER | Official Trailer')).toEqual({ candidates: ['OPPENHEIMER'], year: undefined, type: undefined, people: [] });
    expect(first('Jawan | Official Hindi Trailer | Shah Rukh Khan | Atlee | Nayanthara')).toBe('Jawan');
    expect(first('Animal (Official Teaser): Ranbir Kapoor | Rashmika M, Anil K, Bobby D | Sandeep Vanga')).toBe('Animal');
    expect(first('Oppenheimer – New Trailer (Universal Pictures) - HD')).toBe('Oppenheimer');
    expect(first('Bhool Bhulaiyaa 3 (Official Trailer) Kartik Aaryan, Vidya Balan')).toBe('Bhool Bhulaiyaa 3');
    expect(first('The English Patient Official Trailer #1 - Ralph Fiennes Movie (1996) HD')).toBe('The English Patient');
    expect(parseVideoTitle('Dune: Part Two | Official Trailer 3')!.candidates).toEqual(['Dune: Part Two', 'Dune']);
    expect(parseVideoTitle('Stranger Things Season 5 | Official Trailer | Netflix')).toMatchObject({ candidates: ['Stranger Things'], type: 'tv' });
    expect(first('Official Trailer | Jawan')).toBe('Jawan');
  });

  it('tries "X Movie" before "X", for films whose name ends in Movie', () => {
    expect(parseVideoTitle('The Super Mario Bros. Movie | Official Trailer')!.candidates.slice(0, 2)).toEqual(['The Super Mario Bros Movie', 'The Super Mario Bros']);
    expect(parseVideoTitle('Interstellar Movie Explained in Hindi | पृथ्वी के बाहर दूसरे ग्रह की तलाश | Interstellar 2014')!.candidates.slice(0, 2)).toEqual([
      'Interstellar Movie',
      'Interstellar',
    ]);
  });

  it('reads reviews and explainers, and a year in brackets', () => {
    expect(parseVideoTitle('The Shawshank Redemption (1994) Full Movie Explained in Hindi')).toMatchObject({ candidates: ['The Shawshank Redemption'], year: 1994 });
    expect(first('Interstellar (2014) Malayalam Explanation | നോളചരിതം | Perfect Film in All manner | CinemaStellar')).toBe('Interstellar');
    expect(first('Avengers: Endgame Movie Review')).toBe('Avengers: Endgame Movie');
    expect(parseVideoTitle('Avengers: Endgame Movie Review')!.candidates).toContain('Avengers: Endgame');
    expect(first('Inception Ending Explained | Film Theory')).toBe('Inception');
  });

  it('keeps a name that is a number or that starts with a marker-like word', () => {
    expect(first('1917 Official Trailer')).toBe('1917');
    expect(parseVideoTitle('1917 Official Trailer')?.year).toBeUndefined();
    expect(first('Blade Runner 2049 - Official Trailer')).toBe('Blade Runner 2049');
    expect(parseVideoTitle('Blade Runner 2049 - Official Trailer')?.year).toBeUndefined();
    expect(first('Hindi Medium | Official Trailer | Irrfan Khan')).toBe('Hindi Medium');
  });

  it('ignores videos that do not say they are about a film', () => {
    expect(parseVideoTitle('Robert Oppenheimer & Jean Tatlock || Only love can hurt like this')).toBeNull();
    expect(parseVideoTitle('Oppenheimer: The Real Story | Documentary')).toBeNull();
    expect(parseVideoTitle('Interstellar 4K HDR IMAX | Into The Black Hole - Gargantua 1/2')).toBeNull();
    expect(parseVideoTitle('How I cleaned my home in 10 minutes')).toBeNull();
  });

  it('ignores round-ups and titles with no name in them', () => {
    expect(parseVideoTitle('Top 10 Best Horror Movies of 2023')).toBeNull();
    expect(parseVideoTitle('5 Movies Like Interstellar You Must Watch')).toBeNull();
    expect(parseVideoTitle('New South Indian Hindi Dubbed Full Movie 2024 | Latest Blockbuster Action Movie')).toBeNull();
    expect(parseVideoTitle('Hindi Dubbed Full Movie | HD')).toBeNull();
  });

  it('skips a round-up piece after the name, and hashtags', () => {
    expect(first('Pushpa 2 Full Movie | Latest South Movies 2024')).toBe('Pushpa 2');
    expect(parseVideoTitle('Pushpa 2 Full Movie | Latest South Movies 2024')?.year).toBeUndefined();
    expect(first('#Pushpa2 Pushpa 2 Official Trailer #AlluArjun')).toBe('Pushpa 2');
  });
});

describe('parseVideoTitle: Hindi-dub uploads', () => {
  it('treats a capital I as a separator, and stops the name at "New Release"', () => {
    expect(parseVideoTitle('HIDIMA KING I Prabhas & Nandita Swetha New Movie I Vijay Sethupathi Latest South Action Movie 2026')).toMatchObject({
      candidates: ['HIDIMA KING'],
      people: ['Prabhas', 'Nandita Swetha', 'Vijay Sethupathi'],
    });
    expect(parseVideoTitle('Paradha 2026 New Release South Thriller Movie I Anupama Parameswaran, Darshana Rajendran, Sangeetha')).toMatchObject({
      candidates: ['Paradha'],
      year: 2026,
      people: ['Anupama Parameswaran', 'Darshana Rajendran', 'Sangeetha'],
    });
  });

  it('reads the name and the cast from the usual dub-channel layouts', () => {
    expect(parseVideoTitle('BAGHEERA (2026) New Released Full Hindi Dubbed Movie I Sriimurali, Rukmini Vasanth, Prakash Raj')).toEqual({
      candidates: ['BAGHEERA'],
      year: 2026,
      type: 'movie',
      people: ['Sriimurali', 'Rukmini Vasanth', 'Prakash Raj'],
    });
    expect(parseVideoTitle('THE BOSS CM - New Released South Action Blockbuster Superhit Hindi Movie I Jr.NTR, Pooja Hegde')).toMatchObject({
      candidates: ['THE BOSS CM'],
      people: ['Jr.NTR', 'Pooja Hegde'],
    });
    expect(parseVideoTitle('PARTNER (2026) New Released South Superhit Comedy Movie In Hindi I Aadhi Pinisetty & Hansika Motwani')).toMatchObject({
      candidates: ['PARTNER'],
      people: ['Aadhi Pinisetty', 'Hansika Motwani'],
    });
    expect(parseVideoTitle('Commando 4 | Vidyut Jammwal | 2026 New Blockbuster Full Action Super Hit Movie in 4K I')).toMatchObject({
      candidates: ['Commando 4', 'Vidyut Jammwal'],
    });
  });

  it('does not take a studio or channel for a person', () => {
    expect(parseVideoTitle('Oppenheimer (2023) | HD Full Movie | Universal Studios')!.people).toEqual([]);
  });
});
