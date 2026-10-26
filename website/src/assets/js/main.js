/**
 * too_many_cooks website main JavaScript
 * Dark mode toggle, mobile navigation, and utilities
 */

(function () {
  'use strict';

  const BUTTON_TAG = 'button';
  const DIV_TAG = 'div';
  const ANCHOR_TAG = 'a';
  const PRE_SELECTOR = 'pre';
  const CODE_SELECTOR = 'code';
  const HASH_LINK_SELECTOR = 'a[href^="#"]';
  const HASH_PREFIX = '#';
  const HEADING_SELECTOR =
    '.docs-content h2, .docs-content h3, .blog-post-content h2, .blog-post-content h3';
  const THEME_TOGGLE_ID = 'theme-toggle';
  const MOBILE_MENU_TOGGLE_ID = 'mobile-menu-toggle';
  const NAV_LINKS_SELECTOR = '.nav-links';
  const DOCS_SIDEBAR_ID = 'docs-sidebar';
  const LANGUAGE_SWITCHER_SELECTOR = '.language-switcher';
  const LANGUAGE_BUTTON_SELECTOR = '.language-btn';
  const LANGUAGE_DROPDOWN_SELECTOR = '.language-dropdown';
  const LANGUAGE_ATTRIBUTE = 'lang';
  const EXPANDED_ATTRIBUTE = 'aria-expanded';
  const THEME_ATTRIBUTE = 'data-theme';
  const THEME_STORAGE_KEY = 'theme';
  const LANGUAGE_STORAGE_KEY = 'lang';
  const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
  const ESCAPE_KEY = 'Escape';
  const SMOOTH_BEHAVIOR = 'smooth';
  const DARK = 'dark';
  const LIGHT = 'light';
  const OPEN_CLASS = 'open';
  const ACTIVE_CLASS = 'active';
  const BOOLEAN_TRUE = 'true';
  const BOOLEAN_FALSE = 'false';
  const OPACITY_SHOWN = '1';
  const OPACITY_HIDDEN = '0';
  const RELATIVE_POSITION = 'relative';
  const DISPLAY_BLOCK = 'block';
  const DISPLAY_NONE = 'none';
  const MENU_LABEL = 'Menu';
  const CLOSE_LABEL = 'Close';
  const COPY_LABEL = 'Copy';
  const COPIED_LABEL = 'Copied!';
  const FAILED_LABEL = 'Failed';
  const COPY_RESET_TIMEOUT_MS = 2000;
  const MOBILE_MAX_WIDTH = 1024;
  const SIDEBAR_TOGGLE_CLASS = 'sidebar-toggle';
  const COPY_BUTTON_CLASS = 'copy-btn';
  const HEADING_ANCHOR_CLASS = 'heading-anchor';

  const SIDEBAR_TOGGLE_STYLE = `
      display: none;
      position: fixed;
      bottom: var(--space-4);
      right: var(--space-4);
      padding: var(--space-3) var(--space-6);
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: var(--radius-full);
      font-weight: 500;
      cursor: pointer;
      z-index: 60;
      box-shadow: var(--shadow-lg);
    `;

  const COPY_BUTTON_STYLE = `
      position: absolute;
      top: var(--space-2);
      right: var(--space-2);
      padding: var(--space-1) var(--space-3);
      font-size: var(--text-xs);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--transition-fast);
    `;

  const HEADING_ANCHOR_STYLE = `
        margin-left: var(--space-2);
        color: var(--text-tertiary);
        text-decoration: none;
        opacity: 0;
        transition: opacity var(--transition-fast);
      `;

  const html = document.documentElement;

  // Show the styled element only while the pointer is over its container.
  const bindHoverOpacity = (container, target) => {
    container.addEventListener('mouseenter', () => {
      target.style.opacity = OPACITY_SHOWN;
    });

    container.addEventListener('mouseleave', () => {
      target.style.opacity = OPACITY_HIDDEN;
    });
  };

  // Build a button carrying a class, label and inline styles.
  const createButton = (className, label, cssText) => {
    const button = document.createElement(BUTTON_TAG);
    button.className = className;
    button.innerHTML = label;
    button.style.cssText = cssText;
    return button;
  };

  // --- Theme -------------------------------------------------------------
  const getPreferredTheme = () => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) return saved;

    return window.matchMedia(DARK_SCHEME_QUERY).matches ? DARK : LIGHT;
  };

  const setTheme = (theme) => {
    html.setAttribute(THEME_ATTRIBUTE, theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  };

  const bindThemeToggle = () => {
    const themeToggle = document.getElementById(THEME_TOGGLE_ID);
    if (!themeToggle) return;

    themeToggle.addEventListener('click', () => {
      setTheme(html.getAttribute(THEME_ATTRIBUTE) === DARK ? LIGHT : DARK);
    });
  };

  setTheme(getPreferredTheme());
  bindThemeToggle();

  window.matchMedia(DARK_SCHEME_QUERY).addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_STORAGE_KEY)) {
      setTheme(e.matches ? DARK : LIGHT);
    }
  });

  // --- Language switcher -------------------------------------------------
  const setExpanded = (element, expanded) => {
    element.setAttribute(EXPANDED_ATTRIBUTE, expanded ? BOOLEAN_TRUE : BOOLEAN_FALSE);
  };

  const closeLanguageSwitcher = (switcher, switcherButton) => {
    switcher.classList.remove(OPEN_CLASS);
    setExpanded(switcherButton, false);
  };

  const toggleLanguageSwitcher = (switcher, switcherButton) => {
    switcher.classList.toggle(OPEN_CLASS);
    setExpanded(switcherButton, switcher.classList.contains(OPEN_CLASS));
  };

  const bindLanguageLinks = () => {
    const dropdown = document.querySelector(LANGUAGE_DROPDOWN_SELECTOR);
    if (!dropdown) return;

    dropdown.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        const lang = link.getAttribute(LANGUAGE_ATTRIBUTE);
        if (lang) localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      });
    });
  };

  const bindLanguageSwitcher = () => {
    const switcher = document.querySelector(LANGUAGE_SWITCHER_SELECTOR);
    const switcherButton = document.querySelector(LANGUAGE_BUTTON_SELECTOR);
    if (!switcher || !switcherButton) return;

    switcherButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleLanguageSwitcher(switcher, switcherButton);
    });

    bindLanguageLinks();

    document.addEventListener('click', (event) => {
      if (!switcher.contains(event.target)) {
        closeLanguageSwitcher(switcher, switcherButton);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === ESCAPE_KEY && switcher.classList.contains(OPEN_CLASS)) {
        closeLanguageSwitcher(switcher, switcherButton);
      }
    });
  };

  // --- Mobile navigation menu -------------------------------------------
  const bindMobileMenu = () => {
    const mobileMenuToggle = document.getElementById(MOBILE_MENU_TOGGLE_ID);
    const navLinks = document.querySelector(NAV_LINKS_SELECTOR);
    if (!mobileMenuToggle || !navLinks) return;

    mobileMenuToggle.addEventListener('click', () => {
      navLinks.classList.toggle(OPEN_CLASS);
      mobileMenuToggle.classList.toggle(ACTIVE_CLASS);
    });

    document.addEventListener('click', (event) => {
      if (!navLinks.contains(event.target) && !mobileMenuToggle.contains(event.target)) {
        navLinks.classList.remove(OPEN_CLASS);
        mobileMenuToggle.classList.remove(ACTIVE_CLASS);
      }
    });
  };

  // --- Docs sidebar toggle (mobile) -------------------------------------
  const bindDocsSidebar = () => {
    const docsSidebar = document.getElementById(DOCS_SIDEBAR_ID);
    if (!docsSidebar) return;

    const sidebarToggle = createButton(SIDEBAR_TOGGLE_CLASS, MENU_LABEL, SIDEBAR_TOGGLE_STYLE);
    document.body.appendChild(sidebarToggle);

    const checkMobile = () => {
      sidebarToggle.style.display =
        window.innerWidth <= MOBILE_MAX_WIDTH ? DISPLAY_BLOCK : DISPLAY_NONE;
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    sidebarToggle.addEventListener('click', () => {
      docsSidebar.classList.toggle(OPEN_CLASS);
      sidebarToggle.innerHTML = docsSidebar.classList.contains(OPEN_CLASS)
        ? CLOSE_LABEL
        : MENU_LABEL;
    });
  };

  // --- Smooth scroll for anchor links -----------------------------------
  const bindAnchor = (anchor) => {
    anchor.addEventListener('click', function (event) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: SMOOTH_BEHAVIOR });
      }
    });
  };

  const bindSmoothScroll = () => {
    document.querySelectorAll(HASH_LINK_SELECTOR).forEach(bindAnchor);
  };

  // --- Copy buttons on code blocks --------------------------------------
  const copyCode = async (copyButton, pre) => {
    const code = pre.querySelector(CODE_SELECTOR);
    const text = code ? code.textContent : pre.textContent;

    try {
      await navigator.clipboard.writeText(text);
      copyButton.innerHTML = COPIED_LABEL;
      setTimeout(() => {
        copyButton.innerHTML = COPY_LABEL;
      }, COPY_RESET_TIMEOUT_MS);
    } catch (err) {
      copyButton.innerHTML = FAILED_LABEL;
    }
  };

  const bindCopyButton = (pre) => {
    const wrapper = document.createElement(DIV_TAG);
    wrapper.style.position = RELATIVE_POSITION;
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const copyButton = createButton(COPY_BUTTON_CLASS, COPY_LABEL, COPY_BUTTON_STYLE);
    wrapper.appendChild(copyButton);
    bindHoverOpacity(wrapper, copyButton);

    copyButton.addEventListener('click', () => {
      copyCode(copyButton, pre);
    });
  };

  const bindCopyButtons = () => {
    document.querySelectorAll(PRE_SELECTOR).forEach(bindCopyButton);
  };

  // --- Heading anchors for docs ----------------------------------------
  const createHeadingAnchor = (heading) => {
    const anchor = document.createElement(ANCHOR_TAG);
    anchor.href = `${HASH_PREFIX}${heading.id}`;
    anchor.className = HEADING_ANCHOR_CLASS;
    anchor.innerHTML = HASH_PREFIX;
    anchor.style.cssText = HEADING_ANCHOR_STYLE;
    return anchor;
  };

  const bindHeadingAnchor = (heading) => {
    if (!heading.id) return;

    const anchor = createHeadingAnchor(heading);
    heading.style.position = RELATIVE_POSITION;
    heading.appendChild(anchor);
    bindHoverOpacity(heading, anchor);
  };

  const bindHeadingAnchors = () => {
    document.querySelectorAll(HEADING_SELECTOR).forEach(bindHeadingAnchor);
  };

  bindLanguageSwitcher();
  bindMobileMenu();
  bindDocsSidebar();
  bindSmoothScroll();
  bindCopyButtons();
  bindHeadingAnchors();
})();
