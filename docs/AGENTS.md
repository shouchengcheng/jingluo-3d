# AGENTS.md — AI 编程助手全局工程规范

你在本仓库中执行任何代码生成、重构或数据录入任务时，**必须严格遵守以下铁律**。

---

## 1. 核心架构红线（严禁违反）
1. **纯 3D 原则**：本项目为纯 3D 交互系统，**严禁**引入任何 2D SVG 人体底图或 2D/3D 切换抽象层。
2. **React 与 Three.js 严格隔离**：
   * 所有 Three.js 场景、相机、灯光、Raycaster、动画循环必须封装在 `src/engine/` 目录下的纯 TypeScript 类中。
   * **严禁**在 React 组件的 `useState` 或 `useEffect` 中直接驱动 `requestAnimationFrame` 渲染帧。
   * **严禁**引入 `@react-three/fiber`（统一使用原生 `three` 包以控制体积与稳定性）。
3. **资产加载必须走抽象层**：加载 `.glb` 模型或 JSON 数据时，必须通过 `src/engine/AssetLoader.ts`，禁止在业务组件中散落硬编码 `fetch()`。
4. **开发工具严禁泄露至生产环境**：`src/dev-tools/` 下的 3D 复核标定面板必须包裹在 `import.meta.env.DEV` 条件判断内。

---

## 2. 开源协议与版权合规红线
1. **保护上游版权声明**：**严禁**删除或篡改 `licenses/UPSTREAM-AICUC-MIT.txt`、根目录 `LICENSE` 以及 UI 底部/关于弹窗中对 `aicuc/3d-acupoint-atlas`（MIT License）的开源致谢与署名。
2. **双协议边界**：
   * 新增第三方代码依赖时，必须确认其协议与 `MIT License` 兼容（禁止引入 GPL 等强传染性依赖导致主代码协议冲突）。
   * 新增的数据文件（`data/`）属于 `CC BY-NC-SA 4.0` 覆盖范围，需在元数据中保持来源字段清晰（如 `source: "aicuc/3d-acupoint-atlas"` 或 `standard: "GB/T 12346-2021"`）。

---

## 3. 数据规范与学术严谨性
1. **国家标准对齐**：
   * 所有穴位编码、中文名及 `gbLocation` 字段必须严格遵循 **GB/T 12346-2021**，不得自行编造或修改标准定位原文。
   * 穴位名解（`etymology`）与临床主治（`clinical`）须以本科《针灸学》教材为准，保持客观、简明。
2. **严禁 AI 盲猜 3D 坐标**：
   * 绝对禁止凭空编造 `data/coordinates-3d.json` 中的 `[x, y, z]` 坐标值。
   * 坐标只能来源于：（a）`scripts/import_upstream.mjs` 从上游导入的初稿；（b）人工通过 `AuditCalibration` 3D 射线拾取工具校准导出的数据。
3. **审核状态保护**：
   * 任何批量脚本不得覆盖 `audit.status === "gb_verified"` 的记录。
   * 新增或修改任何 `data/` 下的 JSON 文件后，**必须**执行 `node scripts/validate_data.mjs` 验证通过后方可提交。

---

## 4. Three.js 编码与性能规范
1. **内存防泄漏**：销毁场景或切换经络几何体时，必须显式调用 `.dispose()` 释放 `BufferGeometry`、`Material` 和 `Texture`。
2. **移动端性能保护**：
   * 渲染器像素比必须限制：`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`。
   * 窗口 resize 时必须同步更新 `camera.aspect`、`camera.updateProjectionMatrix()` 和 `renderer.setSize()`。
3. **触控交互友好**：移动端点击拾取穴位时，应为穴位点配置略大于视觉球体的透明碰撞体（Hitbox），防止手机端手指难以点中。

---

## 5. 代码风格与提交前自检
* 全程使用 TypeScript 严格模式（`strict: true`），禁止使用 `any` 类型逃避检查。
* 样式统一使用 Tailwind CSS，优先保证 `< 768px` 手机竖屏与 `>= 1024px` 桌面端双端无溢出、无遮挡。
* 每次完成功能开发后，按顺序执行以下检查：
  1. `npm run typecheck`（TypeScript 类型检查）
  2. `node scripts/validate_data.mjs`（数据 Schema 与国标一致性校验）
  3. `npm run build`（确认生产构建无报错）
