const urlsEndpoint =
  "https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/urls.json";

const cacheTtl = 60 * 60 * 1000;

type ProviderUrls = Record<string, { url: string; name?: string }>;

let cache: {
  data?: ProviderUrls;
  expiresAt: number;
  request?: Promise<ProviderUrls>;
} = {
  expiresAt: 0,
};

// WellFlix core engine is now movie-box.co as requested, totally removing themoviebox.org
const WELLFLIX_CORE_BASE = "https://movie-box.co";

async function fetchProviderUrls(): Promise<ProviderUrls> {
  if (cache.data && Date.now() < cache.expiresAt) {
    return cache.data;
  }
  if (cache.request) {
    return cache.request;
  }

  const request = fetch(urlsEndpoint, { next: { revalidate: 3600 } } as any)
    .then(async (response) => {
      if (!response.ok) throw new Error(`URL config ${response.status}`);
      const data = (await response.json()) as ProviderUrls;
      // Override movieBoxWeb to use movie-box.co as core engine
      if (data.movieBoxWeb) {
        data.movieBoxWeb.url = WELLFLIX_CORE_BASE;
      }
      cache.data = data;
      cache.expiresAt = Date.now() + cacheTtl;
      return data;
    })
    .catch(() => {
      if (cache.data) return cache.data;
      return {
        movieBoxWeb: { url: WELLFLIX_CORE_BASE, name: "MovieBox Web" },
      } as ProviderUrls;
    })
    .finally(() => {
      cache.request = undefined;
    });

  cache.request = request;
  return request;
}

export const getBaseUrl = async (providerValue: string): Promise<string> => {
  // Force WellFlix core to movie-box.co, remove themoviebox.org totally
  if (providerValue === "movieBoxWeb") return WELLFLIX_CORE_BASE;
  try {
    const providerUrls = await fetchProviderUrls();
    return providerUrls[providerValue]?.url ?? "";
  } catch {
    return "";
  }
};

export const getAllBaseUrls = async (): Promise<ProviderUrls> => {
  const urls = await fetchProviderUrls().catch(() => ({
    movieBoxWeb: { url: WELLFLIX_CORE_BASE },
  }));
  // Ensure core is movie-box.co
  urls.movieBoxWeb = { url: WELLFLIX_CORE_BASE, name: "MovieBox" };
  return urls;
};

export const WELLFLIX_BASE = WELLFLIX_CORE_BASE;
