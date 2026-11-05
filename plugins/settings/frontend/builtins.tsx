import type { Desktop, SettingsSection, Theme } from '@sisyphus/sdk'
import type { ChatSettingsStore } from './chat-store'
import { AppearanceSettings } from './sections/appearance'
import { AssistantSettings, ContextSettings } from './sections/chat'
import { DataSettings } from './sections/data'
import { LimitSettings } from './sections/limits'
import { ProviderSettings } from './sections/providers'
import { ToolSettings } from './sections/tools'

export function builtinSections(
  desktop: Desktop,
  theme: Theme,
  store: ChatSettingsStore,
): SettingsSection[] {
  return [
    {
      id: 'appearance.theme',
      category: 'General',
      title: 'Appearance',
      order: 0,
      description: 'Theme and color scheme.',
      keywords: ['theme', 'system', 'light', 'dark', 'color'],
      component: () => <AppearanceSettings theme={theme} />,
    },
    {
      id: 'chat.providers',
      category: 'Chat',
      title: 'Model providers',
      order: 10,
      description: 'Provider connections, API keys, and model names.',
      keywords: [
        'provider JSON',
        'baseURL',
        'apiKey',
        'OpenAI',
        'server',
        'endpoint',
        'credentials',
        'reload from file',
      ],
      component: () => <ProviderSettings store={store} />,
    },
    {
      id: 'chat.assistant',
      category: 'Chat',
      title: 'Assistant',
      order: 11,
      description: 'System prompt and default instructions.',
      keywords: ['behavior', 'restore default prompt'],
      component: () => <AssistantSettings store={store} />,
    },
    {
      id: 'chat.tools',
      category: 'Chat',
      title: 'Tools and access',
      order: 12,
      description: 'Tool permissions and available tools.',
      keywords: [
        'access level',
        'read',
        'write',
        'files',
        'computer',
        'screenshots',
        'shell',
        'commands',
      ],
      component: () => <ToolSettings store={store} />,
    },
    {
      id: 'chat.limits',
      category: 'Chat',
      title: 'Reply limits',
      order: 13,
      description: 'Tool steps, retries, and timeouts.',
      keywords: [
        'tool steps per reply',
        'retries per model call',
        'seconds before the reply starts',
        'seconds of silence between chunks',
        'tool seconds per call',
        'remove limits',
        'default limits',
      ],
      component: () => <LimitSettings store={store} />,
    },
    {
      id: 'chat.context',
      category: 'Chat',
      title: 'Context memory',
      order: 14,
      description: 'Automatic compaction and context token budget.',
      keywords: ['summarize', 'history', 'model context window'],
      component: () => <ContextSettings store={store} />,
    },
    {
      id: 'data.locations',
      category: 'Storage',
      title: 'Local data',
      order: 20,
      description: 'Open files and folders used by the app.',
      keywords: ['app data', 'locations', 'backup', 'storage', 'disk'],
      component: () => <DataSettings desktop={desktop} />,
    },
  ]
}
