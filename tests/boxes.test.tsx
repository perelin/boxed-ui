import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { pickMode, styleFor } from '../hooks/register'

const THEMES: Record<string, string> = {
  'native.json': JSON.stringify({ dark: { prompt: { bg: 'userMessageBackground' }, reply: { border: 'subtle' } } }),
  'outline.json': JSON.stringify({ dark: { prompt: { border: '#5b9bd5' }, reply: { border: '#e8834e' } } }),
  'claude-warm.json': JSON.stringify({
    dark: { prompt: { bg: '#4a2a1c' }, reply: { bg: '#1a1a1a' } },
    light: { prompt: { bg: '#f3dccf' }, reply: { bg: '#f6f2ec' } },
  }),
}

function world(on: On, opts: { theme: string; active?: string; mode?: string }) {
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, { ...(opts.active ? { active: opts.active } : {}), ...(opts.mode ? { mode: opts.mode } : {}) })
  on('config.list', () => ({ value: [{ key: 'theme', value: opts.theme }] }) as any)
  on('fs.exists', ($, e: any) => ({ value: String(e.path).endsWith('/themes') && !String(e.path).startsWith('/home') }) as any)
  on('fs.list', () => ({ value: Object.keys(THEMES).map(name => ({ name, kind: 'file' })) }) as any)
  on('fs.read', ($, e: any) => ({ value: THEMES[String(e.path).split('/').pop() ?? ''] ?? '' }) as any)
  // stands for the engine's own drawing of the row
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-reply</Text>
  })
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-result</Text>
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-prompt</Text>
  })
}

const reply = { surface: 'terminal', component: 'AssistantMessage', requestId: 'm1', props: { text: '# Hi', isFirstOfReply: true } } as any

test('reply keeps the engine drawing inside a box in the light variant', async ($, on) => {
  world(on, { theme: 'light', active: 'claude-warm' })
  const json = JSON.stringify(await $.ui.render(reply))
  expect(json).toContain('engine-reply')
  expect(json).toContain('#f6f2ec')
  expect(json).not.toContain('#1a1a1a')
})

test('native theme frames replies with a theme key', async ($, on) => {
  world(on, { theme: 'dark' })
  const json = JSON.stringify(await $.ui.render(reply))
  expect(json).toContain('engine-reply')
  expect(json).toContain('subtle')
})

test('off leaves the engine drawing alone', async ($, on) => {
  world(on, { theme: 'dark', active: 'off' })
  const json = JSON.stringify(await $.ui.render(reply))
  expect(json).toContain('engine-reply')
  expect(json).not.toContain('backgroundColor')
  expect(json).not.toContain('borderStyle')
})

test('task notifications keep their own row', async ($, on) => {
  world(on, { theme: 'dark', active: 'claude-warm' })
  const json = JSON.stringify(await $.ui.render({
    surface: 'terminal', component: 'UserMessage', requestId: 'u1',
    props: { text: 'done', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 't1', status: 'completed' } },
  } as any))
  expect(json).toContain('engine-prompt')
  expect(json).not.toContain('#4a2a1c')
})

test('a prompt is drawn in the prompt box without the engine background underneath', async ($, on) => {
  world(on, { theme: 'dark', active: 'claude-warm' })
  const json = JSON.stringify(await $.ui.render({
    surface: 'terminal', component: 'UserMessage', requestId: 'u2',
    props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: false },
  } as any))
  expect(json).toContain('hello')
  expect(json).not.toContain('engine-prompt')
  expect(json).toContain('#4a2a1c')
})

test('a theme with one variant serves both modes', () => {
  const theme = { dark: { reply: { bg: '#000000' } } }
  expect(styleFor(theme, 'light', 'reply')).toEqual({ bg: '#000000' })
  expect(styleFor(undefined, 'dark', 'reply')).toBe(undefined)
})

test('auto counts as dark unless a mode is pinned', () => {
  expect(pickMode('auto', undefined)).toBe('dark')
  expect(pickMode('light-daltonized', undefined)).toBe('light')
  expect(pickMode('dark', 'light')).toBe('light')
  expect(pickMode('auto', 'bogus')).toBe('dark')
})

test('auto with a pinned light mode picks the light variant', async ($, on) => {
  world(on, { theme: 'auto', active: 'claude-warm', mode: 'light' })
  const json = JSON.stringify(await $.ui.render(reply))
  expect(json).toContain('#f6f2ec')
})

const answer = (props: Record<string, unknown>) => ({
  surface: 'terminal', component: 'ToolResult', requestId: 't1',
  props: { tool_use_id: 't1', tool: 'AskUserQuestion', output: { questions: [], answers: {} }, isErrored: false, ...props },
}) as any

test('answers given in the question dialog sit in the prompt box', async ($, on) => {
  world(on, { theme: 'dark', active: 'claude-warm' })
  const json = JSON.stringify(await $.ui.render(answer({})))
  expect(json).toContain('engine-result')
  expect(json).toContain('#4a2a1c')
  // the engine's row brings its own blank line on top
  expect(json).toContain('"paddingTop":0')
})

test('other tool results and a refused dialog keep their own row', async ($, on) => {
  world(on, { theme: 'dark', active: 'claude-warm' })
  for (const props of [{ tool: 'Bash', output: { stdout: '', stderr: '', interrupted: false } }, { isErrored: true }]) {
    const json = JSON.stringify(await $.ui.render(answer(props)))
    expect(json).toContain('engine-result')
    expect(json).not.toContain('#4a2a1c')
  }
})

test('a framed prompt pads above and below like a filled one', async ($, on) => {
  world(on, { theme: 'dark', active: 'outline' })
  const json = JSON.stringify(await $.ui.render({
    surface: 'terminal', component: 'UserMessage', requestId: 'u3',
    props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: false },
  } as any))
  expect(json).toContain('#5b9bd5')
  expect(json).toContain('"paddingTop":1')
  expect(json).toContain('"paddingBottom":1')
  expect(json).not.toContain('backgroundColor')
})
