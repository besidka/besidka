export const CONNECTOR_CURATION_VERSION = '2026-11-16.4'

export interface CuratedConnector {
  id: string
  title: string
  description?: string
  registryName?: string
  presetId?: string
}

/**
 * The "Top connectors" of the directory, best first. The registry has no
 * popularity data, so this list is the only ranking signal. Each entry names
 * its exact registry `name` (or a preset id when the service is not in the
 * registry) and the display title, because many official entries have no
 * registry title. An entry missing from the mirror is skipped. Editing rules
 * are in docs/connectors.md section 10.3.
 */
export const CURATED_CONNECTORS = [
  {
    id: 'github',
    title: 'GitHub',
    description: 'Work with repositories, issues and pull requests on GitHub.',
    presetId: 'github',
  },
  { id: 'notion', title: 'Notion', registryName: 'com.notion/mcp' },
  { id: 'linear', title: 'Linear', registryName: 'app.linear/linear' },
  {
    id: 'atlassian',
    title: 'Atlassian',
    registryName: 'com.atlassian/atlassian-mcp-server',
  },
  { id: 'figma', title: 'Figma', registryName: 'com.figma.mcp/mcp' },
  { id: 'canva', title: 'Canva', registryName: 'com.canva.mcp/mcp' },
  {
    id: 'stripe',
    title: 'Stripe',
    description: 'Work with your Stripe account: payments, customers, invoices and the docs.',
    presetId: 'stripe',
  },
  {
    id: 'vercel',
    title: 'Vercel',
    description: 'Search the Vercel docs and manage projects and deployments.',
    presetId: 'vercel',
  },
  {
    id: 'supabase',
    title: 'Supabase',
    description: 'Manage your Supabase projects and databases.',
    presetId: 'supabase',
  },
  {
    id: 'sentry',
    title: 'Sentry',
    description: 'Look into Sentry issues and errors in your projects.',
    presetId: 'sentry',
  },
  {
    id: 'monday',
    title: 'monday.com',
    registryName: 'com.monday/monday.com',
  },
  { id: 'airtable', title: 'Airtable', registryName: 'com.airtable/mcp' },
  { id: 'gitlab', title: 'GitLab', registryName: 'com.gitlab/mcp' },
  { id: 'paypal', title: 'PayPal', registryName: 'com.paypal.mcp/mcp' },
  {
    id: 'square',
    title: 'Square',
    description: 'Work with your Square seller account.',
    presetId: 'square',
  },
  {
    id: 'intercom',
    title: 'Intercom',
    description: 'Work with Intercom conversations and contacts.',
    presetId: 'intercom',
  },
  {
    id: 'clickup',
    title: 'ClickUp',
    description: 'Find and manage tasks and docs in your ClickUp workspace.',
    presetId: 'clickup',
  },
  {
    id: 'miro',
    title: 'Miro',
    description: 'Read and create content on your Miro boards.',
    presetId: 'miro',
  },
  {
    id: 'todoist',
    title: 'Todoist',
    description: 'Manage your Todoist tasks and projects.',
    presetId: 'todoist',
  },
  {
    id: 'webflow',
    title: 'Webflow',
    description: 'Manage your Webflow sites and CMS content.',
    presetId: 'webflow',
  },
  {
    id: 'wix',
    title: 'Wix',
    description: 'Search the Wix docs and manage your Wix sites.',
    presetId: 'wix',
  },
  {
    id: 'hugging-face',
    title: 'Hugging Face',
    registryName: 'co.huggingface/hf-mcp-server',
  },
  { id: 'exa', title: 'Exa', registryName: 'ai.exa/exa' },
  {
    id: 'apify',
    title: 'Apify',
    registryName: 'com.apify/apify-mcp-server',
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare',
    description: 'Work with your Cloudflare account: the whole Cloudflare API, from DNS and Workers to R2 and Zero Trust.',
    presetId: 'cloudflare',
  },
  {
    id: 'cloudflare-docs',
    title: 'Cloudflare Docs',
    description: 'Search the Cloudflare developer documentation.',
    registryName: 'com.cloudflare.mcp/mcp',
  },
  { id: 'neon', title: 'Neon', registryName: 'com.neon/mcp' },
  { id: 'railway', title: 'Railway', registryName: 'com.railway/mcp' },
  {
    id: 'postman',
    title: 'Postman',
    registryName: 'com.postman/postman-mcp-server',
  },
  {
    id: 'new-relic',
    title: 'New Relic',
    registryName: 'com.newrelic/mcp-server',
  },
  { id: 'circleci', title: 'CircleCI', registryName: 'com.circleci/mcp' },
  {
    id: 'amplitude',
    title: 'Amplitude',
    registryName: 'com.amplitude/mcp-server',
  },
  { id: 'make', title: 'Make', registryName: 'com.make/mcp-server' },
  { id: 'basecamp', title: 'Basecamp', registryName: 'com.basecamp/mcp' },
  { id: 'lucid', title: 'Lucid', registryName: 'app.lucid.mcp/lucid' },
  {
    id: 'fireflies',
    title: 'Fireflies.ai',
    registryName: 'ai.fireflies/fireflies',
  },
  { id: 'ahrefs', title: 'Ahrefs', registryName: 'com.ahrefs/mcp' },
  { id: 'close', title: 'Close', registryName: 'com.close/close-mcp' },
  {
    id: 'jotform',
    title: 'Jotform',
    description: 'Create forms and read their submissions in Jotform.',
    registryName: 'com.jotform/mcp',
  },
  {
    id: 'pandadoc',
    title: 'PandaDoc',
    registryName: 'com.pandadoc.mcp/mcp',
  },
  { id: 'bitly', title: 'Bitly', registryName: 'com.bitly/mcp' },
  { id: 'mux', title: 'Mux', registryName: 'com.mux/mcp' },
  {
    id: 'cloudinary',
    title: 'Cloudinary',
    registryName: 'com.cloudinary/asset-management-mcp',
  },
  { id: 'egnyte', title: 'Egnyte', registryName: 'com.egnyte/mcp-server' },
  { id: 'axiom', title: 'Axiom', registryName: 'co.axiom/mcp' },
  {
    id: 'microsoft-learn',
    title: 'Microsoft Learn',
    registryName: 'com.microsoft/microsoft-learn-mcp',
  },
  {
    id: 'scrapingbee',
    title: 'ScrapingBee',
    registryName: 'com.scrapingbee/mcp',
  },
] as const satisfies readonly CuratedConnector[]

export interface ConnectorCategory {
  id: string
  label: string
  keywords: readonly string[]
}

export const OTHER_CONNECTOR_CATEGORY_ID = 'other'

/**
 * The directory categories, in display order. The registry has no
 * categories, so an entry's category is derived from the words of its title,
 * name and description (docs/connectors.md section 10.3): a keyword in the
 * title or name counts three times, one in the description once, the highest
 * score wins, a tie goes to the earlier category and no hit is Other.
 * Keywords are lower-case words or phrases without accents.
 */
export const CONNECTOR_CATEGORIES = [
  {
    id: 'developer-tools',
    label: 'Developer tools',
    keywords: [
      'code', 'coding', 'coder', 'developer', 'developers', 'programming',
      'git', 'github', 'gitlab', 'repository', 'repositories', 'repo',
      'pull request', 'pull requests', 'commit', 'commits', 'ci', 'ci cd',
      'devops', 'sdk', 'sdks', 'debug', 'debugging', 'testing', 'unit test',
      'lint', 'linter', 'npm', 'pypi', 'package', 'packages', 'dependency',
      'dependencies', 'ide', 'terminal', 'cli', 'compiler', 'codebase',
      'openapi', 'swagger', 'graphql', 'api testing', 'postman', 'regex',
      'mcp server builder', 'code review', 'snippets', 'stack overflow',
    ],
  },
  {
    id: 'project-management',
    label: 'Project management',
    keywords: [
      'project', 'projects', 'project management', 'task', 'tasks', 'todo',
      'todos', 'to do', 'issue', 'issues', 'ticket', 'tickets', 'jira',
      'kanban', 'sprint', 'sprints', 'roadmap', 'backlog', 'milestone',
      'milestones', 'asana', 'trello', 'linear', 'monday', 'basecamp',
      'clickup', 'okr', 'okrs', 'team', 'teams', 'collaboration',
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    keywords: [
      'email', 'emails', 'mail', 'inbox', 'inboxes', 'gmail', 'outlook',
      'slack', 'discord', 'telegram', 'whatsapp', 'chat', 'chats', 'message',
      'messages', 'messaging', 'sms', 'meeting', 'meetings', 'transcript',
      'transcripts', 'call', 'calls', 'phone', 'voice', 'zoom',
      'notification', 'notifications', 'support', 'helpdesk', 'help desk',
    ],
  },
  {
    id: 'docs-knowledge',
    label: 'Docs & knowledge',
    keywords: [
      'docs', 'documentation', 'wiki', 'wikis', 'knowledge', 'knowledge base',
      'note', 'notes', 'notion', 'confluence', 'obsidian', 'document',
      'documents', 'pdf', 'pdfs', 'reference', 'manual', 'guide', 'guides',
      'book', 'books', 'paper', 'papers', 'research', 'academic', 'arxiv',
      'dictionary', 'encyclopedia', 'learn', 'learning', 'course', 'courses',
      'education', 'library', 'citations', 'memory',
    ],
  },
  {
    id: 'design',
    label: 'Design',
    keywords: [
      'design', 'designs', 'designer', 'figma', 'canva', 'ui', 'ux',
      'mockup', 'mockups', 'prototype', 'prototypes', 'diagram', 'diagrams',
      'whiteboard', 'illustration', 'illustrations', 'icon', 'icons', 'svg',
      'logo', 'logos', 'image', 'images', 'photo', 'photos', 'color',
      'colors', 'palette', 'font', 'fonts', 'creative', '3d', 'video',
      'videos', 'animation', 'presentation', 'presentations', 'slides',
    ],
  },
  {
    id: 'sales-crm',
    label: 'Sales & CRM',
    keywords: [
      'crm', 'sales', 'lead', 'leads', 'prospect', 'prospects',
      'prospecting', 'deal', 'deals', 'pipeline', 'salesforce', 'hubspot',
      'customer', 'customers', 'outreach', 'b2b', 'contacts', 'enrichment',
      'company data', 'firmographic', 'firmographics', 'kyb',
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    keywords: [
      'marketing', 'seo', 'ads', 'advertising', 'campaign', 'campaigns',
      'social media', 'newsletter', 'newsletters', 'brand', 'brands',
      'influencer', 'influencers', 'creator', 'creators', 'backlinks',
      'keyword', 'keywords', 'affiliate', 'growth', 'audience', 'content',
      'copywriting', 'links', 'short links', 'qr code', 'llms txt',
    ],
  },
  {
    id: 'finance-payments',
    label: 'Finance & payments',
    keywords: [
      'payment', 'payments', 'pay', 'invoice', 'invoices', 'invoicing',
      'billing', 'finance', 'financial', 'accounting', 'bank', 'banking',
      'stripe', 'paypal', 'crypto', 'cryptocurrency', 'bitcoin', 'ethereum',
      'wallet', 'wallets', 'blockchain', 'defi', 'trading', 'trade', 'stock',
      'stocks', 'market data', 'tax', 'taxes', 'budget', 'expense',
      'expenses', 'usdc', 'x402', 'stablecoin', 'stablecoins', 'forex',
      'currency', 'onchain', 'on chain', 'solana', 'token price', 'price',
      'prices', 'pricing', 'portfolio', 'investing', 'investment',
    ],
  },
  {
    id: 'data-analytics',
    label: 'Data & analytics',
    keywords: [
      'data', 'database', 'databases', 'sql', 'analytics', 'analysis',
      'metrics', 'dashboard', 'dashboards', 'bigquery', 'postgres',
      'postgresql', 'mysql', 'sqlite', 'warehouse', 'spreadsheet',
      'spreadsheets', 'csv', 'statistics', 'stats', 'insights', 'report',
      'reports', 'query', 'queries', 'dataset', 'datasets', 'airtable',
      'open data', 'census', 'weather',
    ],
  },
  {
    id: 'cloud-infrastructure',
    label: 'Cloud & infrastructure',
    keywords: [
      'cloud', 'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'hosting',
      'deploy', 'deployment', 'deployments', 'infrastructure', 'infra', 'dns',
      'domain', 'domains', 'cdn', 'serverless', 'cloudflare', 'vercel',
      'observability', 'monitoring', 'logs', 'logging', 'uptime', 'security',
      'vulnerability', 'vulnerabilities', 'terraform', 'ssl', 'network',
      'storage', 'backup', 'incident', 'incidents',
    ],
  },
  {
    id: 'productivity',
    label: 'Productivity',
    keywords: [
      'calendar', 'calendars', 'schedule', 'scheduling', 'reminder',
      'reminders', 'productivity', 'form', 'forms', 'survey', 'surveys',
      'automation', 'automations', 'automate', 'workflow', 'workflows',
      'zapier', 'booking', 'bookings', 'appointment', 'appointments',
      'time tracking', 'habit', 'habits', 'personal assistant', 'files',
      'file', 'drive', 'signature', 'e signature', 'contracts', 'contract',
    ],
  },
  {
    id: 'search-web',
    label: 'Search & web',
    keywords: [
      'search', 'web search', 'search engine', 'scrape', 'scraper',
      'scrapers', 'scraping', 'crawl', 'crawler', 'crawling', 'browser',
      'browse', 'browsing', 'web', 'website', 'websites', 'url', 'urls',
      'extract', 'extraction', 'news', 'serp', 'fetch', 'web page',
      'web pages',
    ],
  },
  {
    id: 'shopping-commerce',
    label: 'Shopping & commerce',
    keywords: [
      'shop', 'shops', 'shopping', 'store', 'stores', 'ecommerce',
      'e commerce', 'shopify', 'product', 'products', 'catalog', 'order',
      'orders', 'checkout', 'cart', 'marketplace', 'retail', 'restaurant',
      'restaurants', 'menu', 'food', 'coffee', 'wine', 'grocery', 'deals',
      'discount', 'discounts', 'coupon', 'coupons', 'real estate', 'property',
      'properties', 'travel', 'hotel', 'hotels', 'flight', 'flights', 'events',
    ],
  },
  {
    id: 'legal-government',
    label: 'Legal & government',
    keywords: [
      'law', 'laws', 'legal', 'court', 'courts', 'compliance', 'regulation',
      'regulations', 'regulatory', 'license', 'licenses', 'licence',
      'licences', 'government', 'public records', 'filings', 'sec', 'patent',
      'patents', 'trademark', 'gdpr', 'statute', 'statutes', 'legislation',
      'customs', 'sanctions', 'federal', 'contractor license',
    ],
  },
  {
    id: OTHER_CONNECTOR_CATEGORY_ID,
    label: 'Other',
    keywords: [],
  },
] as const satisfies readonly ConnectorCategory[]

export type ConnectorCategoryId = typeof CONNECTOR_CATEGORIES[number]['id']

/**
 * Hosts on shared platforms where any customer gets a subdomain. A remote on
 * one of them is never a parent-domain icon source (the platform's own icon
 * would show for every tenant).
 */
export const SHARED_HOSTING_SUFFIXES = [
  'vercel.app',
  'netlify.app',
  'workers.dev',
  'pages.dev',
  'up.railway.app',
  'railway.app',
  'herokuapp.com',
  'onrender.com',
  'fly.dev',
  'supabase.co',
  'replit.app',
  'repl.co',
  'lovable.app',
  'github.io',
  'apify.actor',
  'deno.dev',
  'glitch.me',
  'web.app',
  'firebaseapp.com',
  'run.app',
  'azurewebsites.net',
  'amazonaws.com',
  'modal.run',
  'smithery.ai',
] as const

/**
 * Tunnel hosts that point at someone's own machine for a while. The
 * directory hides entries on them as not public.
 */
export const EPHEMERAL_TUNNEL_SUFFIXES = [
  'trycloudflare.com',
  'ngrok.io',
  'ngrok.app',
  'ngrok-free.app',
  'ngrok.dev',
  'loca.lt',
  'localhost.run',
  'serveo.net',
  'localtunnel.me',
] as const
