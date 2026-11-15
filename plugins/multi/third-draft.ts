import { fetchApi } from '@libs/fetch';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';

const SETTING_URL = 'thirdDraftUrl';
const SETTING_API_KEY = 'thirdDraftApiKey';

const PER_PAGE = 24;

type TagKind =
  | 'rating'
  | 'warning'
  | 'category'
  | 'fandom'
  | 'relationship'
  | 'character'
  | 'freeform';

type TagRef = {
  id: number;
  name: string;
  kind: TagKind;
};

type AuthorRef = {
  id: number;
  name: string;
};

type WorkStatus = 'ongoing' | 'complete' | 'unknown';

type WorkStats = {
  words: number;
  chaptersPosted: number;
  chaptersTotal: number | null;
  kudos: number;
  bookmarks: number;
  hits: number;
};

type WorkSummary = {
  id: number;
  title: string;
  summaryHtml: string | null;
  language: string | null;
  status: WorkStatus;
  publishedOn: string | null;
  updatedOn: string | null;
  stats: WorkStats;
  authors: AuthorRef[];
  tags: Record<TagKind, TagRef[]>;
};

type ChapterSummary = {
  id: number;
  position: number;
  title: string | null;
};

type WorkDetail = WorkSummary & {
  chapters: ChapterSummary[];
};

type ChapterDetail = {
  summaryHtml: string | null;
  notesHtml: string | null;
  endnotesHtml: string | null;
  contentHtml: string;
};

type WorkList = {
  items: WorkSummary[];
};

/** Group thousands so hit/kudos counters stay readable in the metadata list. */
function formatCount(value: number | null): string {
  return String(value || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Work summaries are HTML; the reader shows the summary as plain text, so turn
 * block-level markup into line breaks before dropping the tags.
 */
function htmlToText(html?: string | null): string | undefined {
  if (!html) return undefined;

  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > 0 ? text : undefined;
}

class ThirdDraftPlugin implements Plugin.PluginBase {
  id = 'third-draft';
  name = 'Third Draft';
  icon = 'src/multi/third-draft/icon.png';
  version = '1.0.0';

  /** Read on every access so a change in the settings screen applies at once. */
  get site(): string {
    const url = storage.get<string>(SETTING_URL) ?? '';
    return url.trim().replace(/\/+$/, '');
  }

  get apiKey(): string {
    return (storage.get<string>(SETTING_API_KEY) ?? '').trim();
  }

  /** Mirrored images live behind the same bearer token as the API. */
  get imageRequestInit(): Plugin.ImageRequestInit | undefined {
    const key = this.apiKey;
    if (!key) return undefined;
    return { headers: { Authorization: `Bearer ${key}` } };
  }

  private buildUrl(path: string): string {
    if (!this.site) {
      throw new Error('Set your Third Draft server URL in the plugin settings');
    }
    if (!this.apiKey) {
      throw new Error('Set a Third Draft API key in the plugin settings');
    }
    return this.site + path;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetchApi(this.buildUrl(path), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (response.status === 401) {
      throw new Error('Third Draft rejected the API key (401 Unauthorized)');
    }
    if (response.status === 403) {
      throw new Error(
        'Third Draft refused the request (403 Forbidden); check the API key access',
      );
    }
    if (!response.ok) {
      throw new Error(
        `Third Draft request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }

  private static workId(path: string): number {
    const id = Number(path);
    if (!(id > 0) || Math.floor(id) !== id) {
      throw new Error(`Invalid Third Draft work path: ${path}`);
    }
    return id;
  }

  private static chapterRef(path: string): {
    workId: number;
    chapterId: number;
  } {
    const parts = path.split('/');
    const workId = ThirdDraftPlugin.workId(parts[0]);
    const chapterId = Number(parts[1]);
    if (!(chapterId > 0) || Math.floor(chapterId) !== chapterId) {
      throw new Error(`Invalid Third Draft chapter path: ${path}`);
    }
    return { workId, chapterId };
  }

  /** Root-relative image and link targets only make sense against the server. */
  private absolutize(html: string): string {
    const site = this.site;
    if (!html || !site) return html;

    const $ = parseHTML(html, null, false);

    const rewrite = (selector: string, attribute: 'src' | 'href') => {
      $(selector).each((_, element) => {
        const $element = $(element);
        const value = $element.attr(attribute);
        if (value && value.charAt(0) === '/' && value.charAt(1) !== '/') {
          $element.attr(attribute, site + value);
        }
      });
    };

    rewrite('img, source, video, audio, track', 'src');
    rewrite('a', 'href');

    return $.html();
  }

  private static statusFor(work: WorkSummary): string {
    switch (work.status) {
      case 'complete':
        return NovelStatus.Completed;
      case 'ongoing':
        return NovelStatus.Ongoing;
      default:
        return NovelStatus.Unknown;
    }
  }

  private static infoFor(
    work: WorkSummary,
  ): { label: string; value: string }[] {
    const stats = work.stats;
    const info = [
      {
        label: 'Chapters',
        value: stats.chaptersTotal
          ? `${stats.chaptersPosted}/${stats.chaptersTotal}`
          : String(stats.chaptersPosted),
      },
      { label: 'Words', value: formatCount(stats.words) },
      { label: 'Kudos', value: formatCount(stats.kudos) },
      { label: 'Bookmarks', value: formatCount(stats.bookmarks) },
      { label: 'Hits', value: formatCount(stats.hits) },
    ];

    if (work.language) {
      info.unshift({ label: 'Language', value: work.language });
    }
    if (work.publishedOn) {
      info.push({ label: 'Published', value: work.publishedOn });
    }
    if (work.updatedOn) info.push({ label: 'Updated', value: work.updatedOn });

    return info;
  }

  private async listWorks(
    pageNo: number,
    query: string,
  ): Promise<Plugin.NovelItem[]> {
    const page = pageNo > 0 ? pageNo : 1;
    const result = await this.request<WorkList>(
      `/api/works?page=${page}&perPage=${PER_PAGE}${query}`,
    );

    if (!Array.isArray(result.items) || result.items.length === 0) return [];

    return result.items.map(work => ({
      name: work.title,
      path: String(work.id),
      cover: defaultCover,
    }));
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const sort = showLatestNovels ? 'updated' : filters?.sort.value;

    return this.listWorks(pageNo, `&sort=${sort || 'updated'}`);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const work = await this.request<WorkDetail>(
      `/api/works/${ThirdDraftPlugin.workId(novelPath)}`,
    );

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: work.title,
      cover: defaultCover,
      status: ThirdDraftPlugin.statusFor(work),
      info: ThirdDraftPlugin.infoFor(work),
      chapters: work.chapters.map(chapter => ({
        name: chapter.title || `Chapter ${chapter.position}`,
        path: `${work.id}/${chapter.id}`,
        chapterNumber: chapter.position,
      })),
    };

    const authors = work.authors.map(author => author.name);
    if (authors.length > 0) novel.author = authors.join(', ');

    const tags = (work.tags.fandom || []).concat(work.tags.freeform || []);
    if (tags.length > 0) novel.genres = tags.map(tag => tag.name).join(', ');

    const summary = htmlToText(work.summaryHtml);
    if (summary) novel.summary = summary;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const { workId, chapterId } = ThirdDraftPlugin.chapterRef(chapterPath);
    const chapter = await this.request<ChapterDetail>(
      `/api/works/${workId}/chapters/${chapterId}`,
    );

    const html = [
      chapter.summaryHtml,
      chapter.notesHtml,
      chapter.contentHtml,
      chapter.endnotesHtml,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n');

    return this.absolutize(html);
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const term = searchTerm.trim();
    if (term.length === 0) return [];

    return this.listWorks(pageNo, `&q=${encodeURIComponent(term)}`);
  }

  resolveUrl = (path: string, isNovel?: boolean): string => {
    if (isNovel) return `${this.site}/works/${path}`;

    const [workId, chapterId] = path.split('/');
    return `${this.site}/works/${workId}/chapters/${chapterId}`;
  };

  filters = {
    sort: {
      value: 'updated',
      label: 'Sort',
      options: [
        { label: 'Recently updated', value: 'updated' },
        { label: 'Recently published', value: 'published' },
        { label: 'Title (A-Z)', value: 'title' },
        { label: 'Word count', value: 'words' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;

  pluginSettings = {
    thirdDraftUrl: {
      value: '',
      label: 'Server URL (e.g. https://library.example.com)',
    },
    thirdDraftApiKey: {
      value: '',
      label: 'API key (Settings -> API keys)',
    },
  };
}

export default new ThirdDraftPlugin();
