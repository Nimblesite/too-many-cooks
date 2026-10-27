/**
 * Shared identifiers, paths and expected values for the website Playwright suite.
 * [TEST-SUPPORT] One definition per selector/value so specs stop repeating literals.
 */

// Site routes used by the specs.
export const PATHS = {
  home: '/',
  gettingStarted: '/docs/getting-started/',
  howItWorks: '/docs/how-it-works/',
  register: '/docs/register/',
  lock: '/docs/lock/',
  messages: '/docs/messages/',
  plans: '/docs/plans/',
  status: '/docs/status/',
  sitemap: '/sitemap.xml',
  zhHome: '/zh/',
  zhGettingStarted: '/zh/docs/getting-started/',
  zhHowItWorks: '/zh/docs/how-it-works/',
  blog: '/blog/',
  blogPost: '/blog/0-16-the-server-just-starts/',
  vscodeExtension: '/docs/vscode-extension/',
};

export const TOOL_DOC_PATHS = [
  PATHS.howItWorks,
  PATHS.register,
  PATHS.lock,
  PATHS.messages,
  PATHS.plans,
  PATHS.status,
];

export const ZH_PAGE_PATHS = [PATHS.zhHome, PATHS.zhGettingStarted, PATHS.zhHowItWorks];

// DOM selectors.
export const SELECTORS = {
  html: 'html',
  body: 'body',
  header: '.header',
  nav: 'nav',
  main: 'main',
  footer: 'footer',
  hero: '.hero',
  container: '.container',
  headings: 'h1, h2, h3',
  docsLinks: 'a[href*="/docs/"]',
  githubLink: 'a[href*="github.com"]',
  themeToggle: '#theme-toggle',
  languageSwitcher: '.language-switcher',
  languageButton: '.language-btn',
  languageText: 'span:not(.chevron)',
  languageDropdown: '.language-dropdown',
  languageLinks: '.language-dropdown a[lang]',
  activeLanguageLink: '.language-dropdown a.active',
  mobileMenuToggle: '#mobile-menu-toggle',
  navLinks: '.nav-links',
  navLink: '.nav-link',
  docsSidebar: '#docs-sidebar',
  sidebarToggle: '.sidebar-toggle',
  firstCodeBlock: 'pre',
  codeElement: 'pre code',
  copyButton: '.copy-btn',
  headingWithAnchor: '.docs-content h2[id], .doc-content h2[id]',
  headingAnchor: '.heading-anchor',
  quickstartVideo: '#quickstart-video',
  videoSource: '#quickstart-video source',
  videoCaptions: '#quickstart-video track[kind="captions"]',
  quickstart: '.quickstart',
  blogNavLink: 'nav a[href="/blog/"]',
  blogPostLink: '.post-list a.post-title',
  blogPostTitle: '.blog-post-header h1',
  heroInstall: '.hero a.btn-primary',
  heroVideo: '.hero #quickstart-video',
  postCard: '.post-grid .post-card',
  postCardCover: '.post-grid .post-card .post-cover',
  postCardByline: '.post-grid .post-card .byline-name',
  postByline: '.blog-post-header .byline-name',
  postAuthorCard: '.blog-post-footer .author-card',
  postCtaInstall: '.blog-post-footer .cta-band a.btn-primary',
  startServerShot: 'img[src="/assets/images/vsix-start-local-server.png"]',
};

// The extension's Marketplace listing, the target of every install CTA.
export const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=Nimblesite.too-many-cooks';
export const AUTHOR = 'Christian Findlay';

// Attributes and classes the site JavaScript toggles.
export const ATTRIBUTES = {
  theme: 'data-theme',
  lang: 'lang',
  expanded: 'aria-expanded',
  href: 'href',
  content: 'content',
};

export const STATE_CLASS = { open: 'open', active: 'active' };
export const CLASS_PATTERNS = { open: /open/, active: /active/ };

export const CSS_PROPERTIES = {
  overflow: 'overflow',
  paddingTop: 'paddingTop',
  paddingLeft: 'paddingLeft',
  zIndex: 'zIndex',
  opacity: 'opacity',
  display: 'display',
};

export const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  smallMobile: { width: 480, height: 800 },
  desktop: { width: 1280, height: 800 },
};

// Event-handler settle times (ms).
export const WAITS = {
  handler: 50,
  short: 100,
  style: 300,
  pageSettled: 500,
  smoothScroll: 800,
  clipboardReset: 2500,
};

export const THEMES = { dark: 'dark', light: 'light' };
export const LANGS = { en: 'en', zh: 'zh' };
export const STORAGE_KEYS = { theme: 'theme', lang: 'lang' };

export const TEXT = {
  zhNativeName: '中文',
  enNativeName: 'English',
  zhDocsNavLink: '文档',
  sidebarOpen: 'Close',
  sidebarClosed: 'Menu',
  copyIdle: 'Copy',
  copyDone: 'Copied!',
  copyFailed: 'Failed',
  ariaTrue: 'true',
  ariaFalse: 'false',
};

export const CSS_VALUES = { overflowVisible: 'visible' };

export const ELEMENT_STATE = { visible: 'visible' };

export const TIMEOUTS = { elementVisible: 10000, copyReset: 1000 };

export const CLIPBOARD_PERMISSIONS = ['clipboard-read', 'clipboard-write'];

export const ALLOWED_THEMES = [THEMES.light, THEMES.dark];

export const LOCALES = { en: 'en_US', zh: 'zh_CN' };
export const ALLOWED_LOCALES = [LOCALES.en, LOCALES.zh];

export const TITLES = {
  home: /Too Many Cooks/i,
  gettingStarted: /Getting Started/i,
  blogPost: /Too Many Cooks 0\.16/,
};

export const STATUS_OK = 200;

// Layout thresholds asserted by the responsive specs.
export const THRESHOLDS = {
  minDropdownHeight: 50,
  minDropdownWidth: 100,
  minZIndex: 1000,
  minContainerPadding: 16,
  opacityVisible: 0.8,
  opacityHidden: 0.2,
};

// The homepage quickstart film [WEB-VIDEO]: tracked in Git LFS, so a checkout
// without LFS serves ~130-byte pointer files instead of media.
export const VIDEO = {
  sourceCount: 2,
  minMediaBytes: 10_000,
  types: { mp4: 'video/mp4', jpeg: 'image/jpeg', vtt: 'text/vtt' },
  captionsLang: 'en',
};

// One connect line per agent, as the homepage and docs show them.
export const CONNECT_COMMANDS = [
  'claude mcp add --transport http too-many-cooks http://localhost:4040/mcp',
  'codex mcp add too-many-cooks --url http://localhost:4040/mcp',
  'pi mcp add too-many-cooks --url http://localhost:4040/mcp',
];
