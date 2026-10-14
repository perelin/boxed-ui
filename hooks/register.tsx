import type { EngineInterface, Register } from 'claude-code'

// Boxes around the person's prompts (and dialog answers) and Claude's replies. The content inside stays the
// engine's own drawing (next(e)), so markdown, code, tables and links render as without the mod.

export type BoxStyle = { bg?: string; border?: string }
export type Variant = { prompt?: BoxStyle; reply?: BoxStyle }
export type Theme = { description?: string; dark?: Variant; light?: Variant }

const OFF = 'off'
const DEFAULT = 'native'
const PICKER = 'boxed-ui-picker'

let themes: Record<string, Theme> = {}
let active = DEFAULT
let mode: Mode = 'dark'

async function readThemes($: EngineInterface, dir: string) {
  const found: Record<string, Theme> = {}
  if (!(await $.fs.exists(dir))) return found
  for (const f of await $.fs.list(dir)) {
    if (!f.name.endsWith('.json')) continue
    try {
      found[f.name.slice(0, -5)] = JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as Theme
    } catch {}
  }
  return found
}

// The person's own themes in ~/.claude/boxed-ui/themes win over the shipped ones of the same name.
async function loadThemes($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  themes = {
    ...(await readThemes($, `${$.plugin.root}/themes`)),
    ...(await readThemes($, `${home}/.claude/boxed-ui/themes`)),
  }
}

type Mode = 'dark' | 'light'

// A mod cannot see the terminal background that Claude Code's `auto` follows, and the macOS
// appearance is no stand-in (light system, dark terminal is common), so `auto` and custom
// themes count as dark unless the person pins a mode with `/boxed-ui light`.
export function pickMode(themeSetting: string, pinned: unknown): Mode {
  if (pinned === 'dark' || pinned === 'light') return pinned
  return themeSetting.startsWith('light') ? 'light' : 'dark'
}

async function detectMode($: EngineInterface): Promise<Mode> {
  const row = (await $.config.list()).find(r => r.key === 'theme')
  return pickMode(String(row?.value ?? ''), await $.store.get('mode'))
}

export function styleFor(theme: Theme | undefined, m: Mode, part: 'prompt' | 'reply'): BoxStyle | undefined {
  if (!theme) return undefined
  return (theme[m] ?? theme.dark ?? theme.light)?.[part]
}

// A row the engine draws (a reply, a dialog answer) starts with its own blank line, so a box
// around it pads only below to sit even; a prompt is drawn here and pads both sides.
function boxProps(s: BoxStyle, wrapsEngineRow: boolean) {
  return {
    flexDirection: 'column' as const,
    marginTop: 1,
    paddingX: s.border ? 1 : 2,
    paddingTop: wrapsEngineRow ? 0 : 1,
    paddingBottom: 1,
    ...(s.bg ? { backgroundColor: s.bg } : {}),
    ...(s.border ? { borderStyle: 'round', borderColor: s.border } : {}),
  }
}

function names() {
  return [OFF, ...Object.keys(themes).sort()]
}

// Loaded once per module load, by whichever hook needs it first: session.start, or a render
// that comes before it after a hot reload.
let ready: Promise<void> | undefined
function init($: EngineInterface) {
  ready ??= (async () => {
    await loadThemes($)
    const stored = await $.store.get('active')
    if (typeof stored === 'string' && (stored === OFF || themes[stored])) active = stored
    mode = await detectMode($)
  })().catch(() => {})
  return ready
}

async function apply($: EngineInterface, name: string) {
  active = name
  await $.store.set('active', name)
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await init($)
    await $.command.register({
      name: 'boxed-ui',
      description: 'Pick the prompt/reply box theme',
      argumentHint: '[name | next | list | off | dark | light | auto]',
    })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    try {
      mode = await detectMode($)
    } catch {}
    $.ui.invalidate('ui.render')
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'boxed-ui' }, async ($, e) => {
    await init($)
    await loadThemes($)
    const all = names()
    const list = all.map(n => (n === active ? `**${n}**` : `\`${n}\``)).join(' · ')
    let want = e.args.trim()
    if (!want) {
      await $.ui.open({ id: PICKER, title: 'Box theme', focus: true, closeOnEscape: true, rows: all.length + 3 })
      return {}
    }
    if (want === 'list') return { text: `Box theme: **${active}** (${mode})\n\n${list}` }
    if (want === 'dark' || want === 'light' || want === 'auto') {
      await (want === 'auto' ? $.store.delete('mode') : $.store.set('mode', want))
      mode = await detectMode($)
      $.ui.invalidate('ui.render')
      return { text: `Box variant: **${mode}**${want === 'auto' ? ' (from the Claude Code theme)' : ' (pinned)'}` }
    }
    if (want === 'next') want = all[(all.indexOf(active) + 1) % all.length] ?? DEFAULT
    if (!all.includes(want)) return { text: `No box theme \`${want}\`. Available: ${list}` }
    await apply($, want)
    return { text: `Box theme: **${want}**` }
  })

  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text>Box themes: {names().join(', ')}. Use /boxed-ui name to switch.</Text>
    }
    const { Box, Text, Select } = $.ui.resolve(e)
    const options = names().map(n => {
      const about = n === OFF ? 'Claude Code as it ships' : themes[n]?.description
      return { value: n, label: about ? `${n}  —  ${about}` : n }
    })
    return (
      <Box flexDirection="column" paddingX={1}>
        <Select
          key="theme"
          autoFocus
          options={options}
          value={active}
          onSelect={async (value: string) => {
            await apply($, value)
            await $.ui.close({ id: PICKER })
          }}
        />
        <Text dimColor>↑/↓ choose · Enter apply · Esc close</Text>
      </Box>
    )
  })

  // Only prompts the person wrote: task notifications and other agents' messages keep their rows.
  // The prompt is drawn here rather than wrapped: the engine paints its own message background
  // under the text, which would show as a second colour inside the box.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await init($)
    const style = styleFor(themes[active], mode, 'prompt')
    if (!style || e.surface !== 'terminal' || e.props.task || e.props.from) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box {...boxProps(style, false)}>
        <Box flexDirection="row">
          <Text color="subtle">❯ </Text>
          <Text>{e.props.text}</Text>
        </Box>
      </Box>
    )
  })

  // The answers given in the AskUserQuestion dialog are the person's words too, so they share
  // the prompt box. Wrapped, not redrawn: the row has no background of its own underneath.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    await init($)
    const style = styleFor(themes[active], mode, 'prompt')
    if (!style || e.surface !== 'terminal' || e.props.tool !== 'AskUserQuestion' || e.props.isErrored) return next(e)
    const inner = await next(e)
    if (!inner) return inner
    const { Box } = $.ui.resolve(e)
    return <Box {...boxProps(style, true)}>{inner}</Box>
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await init($)
    const style = styleFor(themes[active], mode, 'reply')
    if (!style || e.surface !== 'terminal') return next(e)
    const inner = await next(e)
    if (!inner) return inner
    const { Box } = $.ui.resolve(e)
    return <Box {...boxProps(style, true)}>{inner}</Box>
  })
}
