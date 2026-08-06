export interface Post {
  title: string;
  link: string;
  image: string;
  provider?: string;
}

export type TextTracks = {
  title: string;
  language: string;
  type: "application/x-subrip" | "application/ttml+xml" | "text/vtt";
  uri: string;
}[];

export interface Stream {
  server: string;
  link: string;
  type: string;
  quality?: "360" | "480" | "720" | "1080" | "2160";
  subtitles?: TextTracks;
  headers?: any;
}

export interface Info {
  title: string;
  image: string;
  logo?: string;
  synopsis: string;
  imdbId: string;
  tmdbId?: string;
  type: string; // movie | series
  tags?: string[];
  cast?: string[];
  rating?: string;
  linkList: Link[];
  webUrl?: string;
}

export interface EpisodeLink {
  title: string;
  link: string;
  description?: string;
  image?: string;
}

export interface Link {
  title: string;
  quality?: string;
  episodesLink?: string;
  directLinks?: {
    title: string;
    link: string;
    type?: "movie" | "series";
    description?: string;
    image?: string;
  }[];
}

export interface Catalog {
  title: string;
  filter: string;
}
