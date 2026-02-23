// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import rehypeMermaid from 'rehype-mermaid';

// https://astro.build/config
export default defineConfig({
	site: 'https://herdctl.dev',
	markdown: {
		rehypePlugins: [[rehypeMermaid, { strategy: 'pre-mermaid' }]],
	},
	redirects: {
		'/internals/architecture/': '/architecture/overview/',
		'/internals/chat-architecture/': '/architecture/chat-infrastructure/',
		'/internals/runner/': '/architecture/runner/',
		'/internals/scheduler/': '/architecture/scheduler/',
		'/internals/state-management/': '/architecture/state-management/',
	},
	integrations: [
		sitemap(),
		starlight({
			customCss: ['./src/styles/custom.css'],
			title: 'herdctl',
			tagline: 'Autonomous Agent Fleet Management for Claude Code',
			favicon: '/favicon.ico',
			logo: {
				src: './src/assets/herdctl-logo.svg',
				alt: 'herdctl',
			},
			head: [
				// Mermaid client-side rendering
				{
					tag: 'script',
					attrs: { type: 'module' },
					content: `import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'; mermaid.initialize({ startOnLoad: true, theme: 'dark' });`,
				},
				// OpenGraph meta tags
				{
					tag: 'meta',
					attrs: {
						property: 'og:title',
						content: 'herdctl - Autonomous Agent Fleet Management',
					},
				},
				{
					tag: 'meta',
					attrs: {
						property: 'og:description',
						content: 'Autonomous Agent Fleet Management for Claude Code. Orchestrate multiple AI agents with schedules, triggers, and intelligent job management.',
					},
				},
				{
					tag: 'meta',
					attrs: {
						property: 'og:type',
						content: 'website',
					},
				},
				{
					tag: 'meta',
					attrs: {
						property: 'og:image',
						content: 'https://herdctl.dev/og-image.png',
					},
				},
				{
					tag: 'meta',
					attrs: {
						property: 'og:url',
						content: 'https://herdctl.dev',
					},
				},
				// Twitter Card meta tags
				{
					tag: 'meta',
					attrs: {
						name: 'twitter:card',
						content: 'summary_large_image',
					},
				},
				{
					tag: 'meta',
					attrs: {
						name: 'twitter:title',
						content: 'herdctl - Autonomous Agent Fleet Management',
					},
				},
				{
					tag: 'meta',
					attrs: {
						name: 'twitter:description',
						content: 'Autonomous Agent Fleet Management for Claude Code. Orchestrate multiple AI agents with schedules, triggers, and intelligent job management.',
					},
				},
				{
					tag: 'meta',
					attrs: {
						name: 'twitter:image',
						content: 'https://herdctl.dev/og-image.png',
					},
				},
			],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/edspencer/herdctl' },
				{ icon: 'discord', label: 'Discord', href: 'https://discord.gg/d2eXZKtNrh' },
				{ icon: 'rss', label: 'Blog', href: 'https://edspencer.net' },
			],
			credits: false,
			components: {
				Footer: './src/components/Footer.astro',
			},
			sidebar: [
				{
					label: 'Welcome',
					link: '/',
				},
				{
					label: "What's New",
					slug: 'whats-new',
				},
				{
					label: 'Security',
					slug: 'security',
				},
				{
					label: 'Getting Started',
					slug: 'getting-started',
				},
				{
					label: 'Concepts',
					collapsed: true,
					items: [
						{ label: 'Agents', slug: 'concepts/agents' },
						{ label: 'Fleet Composition', slug: 'concepts/fleet-composition' },
						{ label: 'Work Sources', slug: 'concepts/work-sources' },
						{ label: 'Schedules', slug: 'concepts/schedules' },
						{ label: 'Triggers', slug: 'concepts/triggers' },
						{ label: 'Jobs', slug: 'concepts/jobs' },
						{ label: 'Hooks', slug: 'concepts/hooks' },
						{ label: 'Workspaces', slug: 'concepts/workspaces' },
						{ label: 'Sessions', slug: 'concepts/sessions' },
					],
				},
				{
					label: 'Configuration',
					collapsed: true,
					items: [
						{ label: 'Fleet Config', slug: 'configuration/fleet-config' },
						{ label: 'Agent Config', slug: 'configuration/agent-config' },
						{ label: 'Runtime', slug: 'configuration/runtime' },
						{ label: 'Docker', slug: 'configuration/docker' },
						{ label: 'GitHub Work Source', slug: 'configuration/github-work-source' },
						{ label: 'Permissions', slug: 'configuration/permissions' },
						{ label: 'MCP Servers', slug: 'configuration/mcp-servers' },
						{ label: 'Environment', slug: 'configuration/environment' },
					],
				},
				{
					label: 'Integrations',
					collapsed: true,
					items: [
						{ label: 'Web Dashboard', slug: 'integrations/web-dashboard' },
						{ label: 'Discord', slug: 'integrations/discord' },
						{ label: 'Slack', slug: 'integrations/slack' },
					],
				},
				{
					label: 'Guides',
					collapsed: true,
					items: [
						{ label: 'Discord Chat Quick Start', slug: 'guides/discord-quick-start' },
						{ label: 'Slack Chat Quick Start', slug: 'guides/slack-quick-start' },
						{ label: 'Example Projects', slug: 'guides/examples' },
						{ label: 'Persistent Memory', slug: 'guides/persistent-memory' },
						{ label: 'Recipes & Patterns', slug: 'guides/recipes' },
					],
				},
				{
					label: 'Architecture',
					collapsed: true,
					items: [
						{ label: 'Overview', slug: 'architecture/overview' },
						{ label: 'Configuration', slug: 'architecture/configuration' },
						{ label: 'State Management', slug: 'architecture/state-management' },
						{ label: 'Scheduler', slug: 'architecture/scheduler' },
						{ label: 'Runner', slug: 'architecture/runner' },
						{ label: 'Job System', slug: 'architecture/job-system' },
						{ label: 'Work Sources', slug: 'architecture/work-sources' },
						{ label: 'Chat Infrastructure', slug: 'architecture/chat-infrastructure' },
						{ label: 'Discord', slug: 'architecture/discord' },
						{ label: 'Slack', slug: 'architecture/slack' },
						{ label: 'CLI', slug: 'architecture/cli' },
						{ label: 'HTTP API', slug: 'architecture/http-api' },
						{ label: 'Web Dashboard', slug: 'architecture/web-dashboard' },
						{ label: 'Docker Runtime', slug: 'architecture/docker-runtime' },
					],
				},
				{
					label: 'Library Reference',
					collapsed: true,
					items: [
						{ label: 'FleetManager', slug: 'library-reference/fleet-manager' },
					],
				},
				{
					label: 'CLI Reference',
					slug: 'cli-reference',
				},
			],
		}),
	],
});
