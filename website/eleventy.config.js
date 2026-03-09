import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

import { registerFilters } from "./node_modules/eleventy-plugin-techdoc/lib/filters/index.js";
import { registerCollections } from "./node_modules/eleventy-plugin-techdoc/lib/plugins/collections.js";
import { registerShortcodes } from "./node_modules/eleventy-plugin-techdoc/lib/shortcodes/index.js";
import { configureMarkdown } from "./node_modules/eleventy-plugin-techdoc/lib/plugins/markdown.js";
import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import navigation from "@11ty/eleventy-navigation";

const __dirname = dirname(fileURLToPath(import.meta.url));

const techdocOptions = {
  site: {
    name: "too_many_cooks",
    title: "Too Many Cooks - Multi-Agent Coordination MCP Server",
    url: "https://tmc-mcp.dev",
    description: "Too Many Cooks is an MCP server for coordinating multiple AI agents editing the same codebase simultaneously.",
    author: "Christian Findlay",
    themeColor: "#0E7C6B",
    stylesheet: "/assets/css/styles.css",
    ogImage: "/assets/images/og-image.png",
    ogImageWidth: "1200",
    ogImageHeight: "630",
    organization: {
      name: "too_many_cooks",
      logo: "/assets/images/og-image.png",
      sameAs: [
        "https://github.com/melbournedeveloper/too_many_cooks"
      ]
    }
  },
  features: {
    blog: false,
    docs: true,
    darkMode: true,
    i18n: true,
  },
  i18n: {
    defaultLanguage: "en",
    languages: ["en", "zh"],
  },
};

export default function(eleventyConfig) {
  eleventyConfig.setUseGitIgnore(false);

  eleventyConfig.addGlobalData("techdocOptions", techdocOptions);
  eleventyConfig.addGlobalData("supportedLanguages", techdocOptions.i18n.languages);
  eleventyConfig.addGlobalData("defaultLanguage", techdocOptions.i18n.defaultLanguage);

  configureMarkdown(eleventyConfig);
  registerFilters(eleventyConfig, techdocOptions);
  registerCollections(eleventyConfig, techdocOptions);
  registerShortcodes(eleventyConfig);

  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(navigation);

  const techdocAssetsDir = join(__dirname, "node_modules", "eleventy-plugin-techdoc", "assets");
  eleventyConfig.addPassthroughCopy({ [techdocAssetsDir]: "techdoc" });

  const templatesDir = join(__dirname, "node_modules", "eleventy-plugin-techdoc", "templates");
  eleventyConfig.addTemplate(
    "sitemap.njk",
    readFileSync(join(templatesDir, "pages/sitemap.njk"), "utf-8")
  );
  eleventyConfig.addTemplate(
    "robots.txt.njk",
    readFileSync(join(templatesDir, "pages/robots.txt.njk"), "utf-8")
  );
  eleventyConfig.addTemplate(
    "llms.txt.njk",
    readFileSync(join(templatesDir, "pages/llms.txt.njk"), "utf-8")
  );

  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addWatchTarget("src/assets/");

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
}
