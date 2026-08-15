# 皮肤/主题适配契约：面板表面令牌、data-bs-* 钩子与几何定位 CSS 化

**日期**：2026-08-15
**状态**：已实施（本文档含实施偏差记录）
**目标版本**：v0.13.0

## 1. 目标

让 dsh-better-sidebar 在第三方皮肤/主题插件下不再损坏，并给主题作者一套稳定契约。本批修复覆盖：

1. **面板表面不再依赖 `--dsw-specific-sidebar-fill`**（[#106 痛点1](https://github.com/omdsh-dev/DSH-better-sidebar/issues/106)、[#60](https://github.com/omdsh-dev/DSH-better-sidebar/issues/60)、[#105](https://github.com/omdsh-dev/DSH-better-sidebar/issues/105)）：皮肤插件把该令牌改成 `transparent`（玻璃）或深色（浅色模式的左侧导航配色）时，右/底面板要么整体失去填充、要么与标签令牌冲突导致文字不可读。
2. **panel 家族类名统一小写**（#106 痛点2）：`bottomPanel` 等 camelCase 本地名无法被 `[class*='panel']` 这类大小写敏感的子串选择器命中。
3. **稳定语义钩子 `data-bs-*`**（#106 痛点3）：主题以属性寻址表面，不再依赖哈希类名。
4. **几何定位 CSS 化**（#106 痛点4）：角手柄不再由 JS 内联写死 viewport 坐标；拖条负偏移可经 CSS 变量归零。
5. **z-index 让出浮层栈**（[#52](https://github.com/omdsh-dev/DSH-better-sidebar/issues/52)）：面板降到 DSH 浮层（100+）之下，Cordis 弹出框不再被底部工作台遮挡。
6. **终端透明回退**（[#90](https://github.com/omdsh-dev/DSH-better-sidebar/issues/90)）：`--dsw-alias-bg-base: transparent` 时终端回退不透明底色。
7. **刷新图标尺寸统一**（[#57](https://github.com/omdsh-dev/DSH-better-sidebar/issues/57)）、**拖拽布局回归防护**（[#92](https://github.com/omdsh-dev/DSH-better-sidebar/issues/92)）。

## 2. 非目标

- 不做用户可见的「透明度/颜色设置面板」（#105 的 UI 诉求是独立功能，另行排期；本批用通用令牌 + 文档化契约为皮肤插件提供配置入口）。
- 不改 DSH 源码；不改皮肤插件（Aqua / deep-whale 现有覆盖行为在新契约下自然成立）。
- 不做面板 DOM 结构的大改（bottom 面板 left/right 仍由测量值内联写入——那是宿主列几何，不在本批范围）。

## 3. 现状回顾

- `sidebar.module.css`：`.panel`/`.bottomPanel` 背景为 `var(--dsw-specific-sidebar-fill)`（`design-platform.css` 中该令牌 = bluish-50/900，宿主左侧导航专属）；角手柄 `position: fixed` + `Sidebar.tsx` JS 内联 left/top；拖条 `left/top: -4px`；z-index 50/52/55。
- `TerminalView.tsx` `xtermTheme()`：`tokenValue('--dsw-alias-bg-base') || 回退`——`transparent` 是 truthy，回退不触发。
- 刷新图标：Explorer/Git/Diff 用 `IconRefreshOutline16`（16px），Subagent/Browser 用 14px。
- 拖拽布局：`layout.css` 已有 `body[data-dsh-sidebar-dragging] #root { transition: none }`（#92 的 0.12.1 回归报告在静态分析下与现行代码不符，需真实浏览器逐帧验证）。

## 4. 设计

### 4.1 面板表面（`sidebar.module.css`）

```css
.panel        { background: var(--dsw-alias-bg-layer-1); }
.bottom-panel { background: var(--dsw-alias-bg-layer-1); }
```

- 直接消费通用卡片表面令牌，**不新增自有令牌**：皮肤把 `--dsw-specific-sidebar-fill` 透明/深色化后面板仍有可读表面；stock 外观色阶变化仅 ±8 RGB（bluish-50→75 / 900→875），视觉无差。
- 皮肤要整体换面板表面：在 `[data-dsh-better-sidebar]` 作用域覆写 `--dsw-alias-bg-layer-1` 即可（deep-whale 的既有做法）——无需新增旋钮，KISS。

### 4.2 类名与语义钩子

- panel 家族 kebab-case：`bottomPanel→bottom-panel`、`bottomPanelHidden→bottom-panel-hidden`、`bottomResize→bottom-resize`、`bottomResizeActive→bottom-resize-active`、`bottomClose→bottom-close`、`cornerHandle→corner-handle`（`[class*='panel']`/`[class*='resize']`/`[class*='handle']` 等小写子串选择器现在都能命中）。
- `data-bs-*` 钩子（属性寻址，永不随类名变化）：

| 钩子 | 元素 |
|---|---|
| `data-bs-panel="right"` / `"bottom"` | 右面板 / 底面板 |
| `data-bs-toggle-cluster` | 右上角折叠按钮簇 |
| `data-bs-resize-strip="width"` / `"height"` | 宽度/高度拖条 |
| `data-bs-corner-handle` | 共享角手柄 |
| `data-bs-tabbar` | 标签条 |
| `data-bs-pane` / `data-bs-pane-card` | 工作台叶子 / 空面板欢迎卡 |
| `data-bs-browser-bar` | 浏览器地址栏 |

### 4.3 几何定位

- 角手柄移入右面板 DOM，`position: absolute; left: -6px; bottom: calc(var(--dsh-sidebar-height, 0px) + 6px)`——复用拖拽逐帧写入的布局变量，删除 `cornerRef` 内联坐标。
- 拖条保留 `left/top: -4px` 硬编码（居中在面板边，与宿主 frame handle 同款）；浮卡皮肤要规避 `overflow:hidden` 裁剪时，用 `[data-bs-resize-strip="width|height"]` 钩子自行重定位——不新增 CSS 变量（KISS：钩子已提供等价能力）。

### 4.4 z-index

`.toggleCluster` 55→45、`.panel`/`.bottom-panel` 50→40；`.corner-handle` 移入面板后改为面板内局部 `z-index: 2`（不再有全局层级）。依据：DSH 浮层栈为 100（Menu/HoverCard/Tooltip/PopupSelect/Modal=1000），30–99 无任何 DSH 元素；侧边栏自带 + 菜单在面板内部层叠上下文，Tooltip 本就在 100。

### 4.5 终端透明回退

`theme.ts` 新增 `effectiveTokenValue(name)`：`transparent/initial/inherit/unset/''` → `''`（半透明值放行）；`TerminalView` 的 background/foreground 改用它。

### 4.6 其它

- 刷新图标统一 `size={14}`（Explorer/Git/Diff）。
- 新增 `tests/e2e/drag-layout.e2e.ts`：rAF 逐帧采样，断言拖拽期间 `data-dsh-sidebar-dragging` 存在、`#root` transition 为 none、会话列与面板边单调 1:1 跟随。

## 5. 测试

- `tests/theme.spec.ts`：`effectiveTokenValue` 惰性值判定。
- `tests/skin-hooks.spec.tsx`：真实 Sidebar 挂载下 `data-bs-*` 存在性 + 角手柄无内联坐标。
- `tests/e2e/mount.e2e.ts`：追加 `data-bs-*` 存在断言。
- `tests/e2e/drag-layout.e2e.ts`：拖拽逐帧回归。
- 门禁：`pnpm typecheck && pnpm test && pnpm build && pnpm pack && pnpm test:mount`。

## 6. 实施偏差记录

- **角手柄 `z-index` 语义变化**：移入面板后 z-index 为面板内层叠（2，与拖条一致），对外绝对层级由面板（40）决定；两面板同开时手柄盒与底面板上沿无重叠（≥6px 间隙），行为不变。
- **面板默认表面色阶微调**：`--dsw-alias-bg-layer-1` 与旧 `--dsw-specific-sidebar-fill` 相差 ±8 RGB（浅色 75 深色 875），未做像素级补偿（e2e 不依赖具体颜色）。
- **#92 实证结论**：真实挂载 + 逐帧采样验证了拖拽契约——拖拽期间 `data-dsh-sidebar-dragging` 存在、`#root` 的 computed transition 为 `none`（Chrome 下 `transition: none` 计算为 `transition-property: none`，非 `all`）、会话列右边缘与面板边单调 1:1 跟随（总位移差 ≤ 8px）。0.12.1 的抖动报告在现行代码下未复现，回归测试 `tests/e2e/drag-layout.e2e.ts` 守护该契约。
- **拖拽禁用断言修正**：首版断言期望 `transitionProperty === 'all'`（`transition: none` 的误解）；实测 Chrome 返回 `'none'`，已修正。`transition: all` 与 `none` 在 computed style 中不相等。
- **KISS 精简（review 后）**：初版设计了 `--dsh-sidebar-surface` 与 `--dsh-resize-strip-offset` 两个自有令牌；review 认为二者与 `data-bs-*` 钩子 + 作用域覆写 `--dsw-alias-bg-layer-1` 能力重复，已删除——面板直接消费通用令牌、拖条保留 -4px 硬编码（钩子提供重定位入口），契约概念从「令牌 + 钩子」缩为「通用令牌 + 钩子」。
