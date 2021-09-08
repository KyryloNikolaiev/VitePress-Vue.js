import path from 'path'
import fs from 'fs-extra'
import chalk from 'chalk'
import globby from 'globby'
import {
  AliasOptions,
  UserConfig as ViteConfig,
  mergeConfig as mergeViteConfig
} from 'vite'
import { Options as VuePluginOptions } from '@vitejs/plugin-vue'
import {
  SiteData,
  HeadConfig,
  LocaleConfig,
  createLangDictionary
} from './shared'
import { resolveAliases, APP_PATH, DEFAULT_THEME_PATH } from './alias'
import { MarkdownOptions } from './markdown/markdown'

export { resolveSiteDataByRoute } from './shared'

const debug = require('debug')('vitepress:config')

export interface UserConfig<ThemeConfig = any> {
  lang?: string
  base?: string
  title?: string
  description?: string
  head?: HeadConfig[]
  themeConfig?: ThemeConfig
  locales?: Record<string, LocaleConfig>
  markdown?: MarkdownOptions
  /**
   * Opitons to pass on to @vitejs/plugin-vue
   */
  vue?: VuePluginOptions
  /**
   * Vite config
   */
  vite?: ViteConfig

  srcDir?: string
  srcExclude?: string[]

  /**
   * @deprecated use `srcExclude` instead
   */
  exclude?: string[]
  /**
   * @deprecated use `vue` instead
   */
  vueOptions?: VuePluginOptions

  extends?: RawConfigExports
}

type RawConfigExports =
  | UserConfig
  | Promise<UserConfig>
  | (() => UserConfig | Promise<UserConfig>)

export interface SiteConfig<ThemeConfig = any> {
  root: string
  srcDir: string
  site: SiteData<ThemeConfig>
  configPath: string
  themeDir: string
  outDir: string
  tempDir: string
  alias: AliasOptions
  pages: string[]
  markdown: MarkdownOptions | undefined
  vue: VuePluginOptions | undefined
  vite: ViteConfig | undefined
}

const resolve = (root: string, file: string) =>
  path.resolve(root, `.vitepress`, file)

export async function resolveConfig(
  root: string = process.cwd()
): Promise<SiteConfig> {
  const userConfig = await resolveUserConfig(root)

  if (userConfig.vueOptions) {
    console.warn(
      chalk.yellow(`[vitepress] "vueOptions" option has been renamed to "vue".`)
    )
  }
  if (userConfig.exclude) {
    console.warn(
      chalk.yellow(
        `[vitepress] "exclude" option has been renamed to "ssrExclude".`
      )
    )
  }

  const site = await resolveSiteData(root, userConfig)

  const srcDir = path.resolve(root, userConfig.srcDir || '.')

  // resolve theme path
  const userThemeDir = resolve(root, 'theme')
  const themeDir = (await fs.pathExists(userThemeDir))
    ? userThemeDir
    : DEFAULT_THEME_PATH

  const config: SiteConfig = {
    root,
    srcDir,
    site,
    themeDir,
    pages: await globby(['**.md'], {
      cwd: srcDir,
      ignore: ['**/node_modules', ...(userConfig.srcExclude || [])]
    }),
    configPath: resolve(root, 'config.js'),
    outDir: resolve(root, 'dist'),
    tempDir: path.resolve(APP_PATH, 'temp'),
    markdown: userConfig.markdown,
    alias: resolveAliases(themeDir),
    vue: userConfig.vue,
    vite: userConfig.vite
  }

  return config
}

export async function resolveUserConfig(root: string): Promise<UserConfig> {
  // load user config
  const configPath = resolve(root, 'config.js')
  const hasUserConfig = await fs.pathExists(configPath)
  // always delete cache first before loading config
  delete require.cache[configPath]
  const userConfig: RawConfigExports = hasUserConfig ? require(configPath) : {}
  if (hasUserConfig) {
    debug(`loaded config at ${chalk.yellow(configPath)}`)
  } else {
    debug(`no config file found.`)
  }
  return resolveConfigExtends(userConfig)
}

async function resolveConfigExtends(
  config: RawConfigExports
): Promise<UserConfig> {
  const resolved = await (typeof config === 'function' ? config() : config)
  if (resolved.extends) {
    const base = await resolveConfigExtends(resolved.extends)
    return mergeConfig(base, resolved)
  }
  return resolved
}

function mergeConfig(a: UserConfig, b: UserConfig, isRoot = true) {
  const merged: Record<string, any> = { ...a }
  for (const key in b) {
    const value = b[key as keyof UserConfig]
    if (value == null) {
      continue
    }
    const existing = merged[key]
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = [...existing, ...value]
      continue
    }
    if (isObject(existing) && isObject(value)) {
      if (isRoot && key === 'vite') {
        merged[key] = mergeViteConfig(existing, value)
      } else {
        merged[key] = mergeConfig(existing, value, false)
      }
      continue
    }
    merged[key] = value
  }
  return merged
}

function isObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export async function resolveSiteData(
  root: string,
  userConfig?: UserConfig
): Promise<SiteData> {
  userConfig = userConfig || (await resolveUserConfig(root))
  return {
    lang: userConfig.lang || 'en-US',
    title: userConfig.title || 'VitePress',
    description: userConfig.description || 'A VitePress site',
    base: userConfig.base ? userConfig.base.replace(/([^/])$/, '$1/') : '/',
    head: userConfig.head || [],
    themeConfig: userConfig.themeConfig || {},
    locales: userConfig.locales || {},
    langs: createLangDictionary(userConfig)
  }
}
