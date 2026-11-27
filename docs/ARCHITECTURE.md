# 系统架构设计文档 (ARCHITECTURE)

## 1. 架构设计原则
1. **纯 3D 核心，拒绝过度抽象**：移除 2D 视图兼容层，以原生 Three.js 场景引擎为唯一渲染核心，降低维护与 AI 生成代码的复杂度。
2. **数据与渲染彻底解耦**：GB/T 12346-2021 教学文本、3D 模型空间坐标、经络拓扑路径分别独立存储。未来替换更高精度的 3D 模型时，国标文本数据零改动。
3. **React 与 Three.js 状态隔离**：React 仅负责 UI 面板与响应式布局；Three.js 渲染循环独立运行于 `MeridianScene` 类中，通过 Zustand 状态订阅单向驱动，避免 React 重渲染拖垮 3D 帧率。
4. **资产加载抽象（为单文件离线运行预留）**：所有模型与数据加载统一收敛至 `AssetLoader.ts`，未来引入 `vite-plugin-singlefile` 与 `GLTFLoader.parse()` 时，上层业务代码无需修改。
5. **开源合规内建**：独立维护 `licenses/` 目录，明确隔离代码（MIT）、校准数据（CC BY-NC-SA 4.0）与第三方上游资产（`aicuc/3d-acupoint-atlas` MIT）的许可边界。

---

## 2. 系统分层架构

```text
+------------------------------------------------------------------+
|  UI 交互与响应式层 (React 18 + Tailwind CSS)                      |
|  PC 侧边栏 | 移动端 Bottom Sheet | 详情卡 | 检索/盲测 | 复核面板   |
+------------------------------------------------------------------+
|  全局状态层 (Zustand Store)                                       |
|  selectedAcupointId | visibleMeridians | isQuizMode | auditMode  |
+------------------------------------------------------------------+
|  3D 场景引擎层 (原生 Three.js 封装)                               |
|  MeridianScene | OrbitControls | RaycasterPicker | TubeFlowAnim  |
+------------------------------------------------------------------+
|  资产加载与校验层 (AssetLoader + JSON Schema)                     |
|  public/models/*.glb | data/acupoints/*.json | coordinates-3d    |
+------------------------------------------------------------------+
```

---

## 3. 技术栈选型

| 层次 | 技术选型 | 选型依据 |
| :--- | :--- | :--- |
| **构建与语言** | Vite + TypeScript | 强类型接口约束，显著降低 AI 多轮迭代时的字段拼写错误与逻辑漂移。 |
| **UI 与样式** | React 18 + Tailwind CSS | 断点响应式开发效率高，组件生态成熟。 |
| **状态管理** | Zustand | 极简 API，支持在 React 组件外部（Three.js 引擎内）直接订阅和读取状态。 |
| **3D 渲染引擎** | 原生 `Three.js` | 脱离 React 生命周期束缚，内存释放可控，AI 生成标准 Three.js 代码的准确度最高。 |
| **数据校验** | Node.js (`.mjs`) + JSON Schema | 确定性脚本校验国标编码唯一性、字段完整性及 3D 坐标复核覆盖率。 |
| **部署托管** | GitHub Actions + GitHub Pages | 推送代码自动触发校验与构建发布。 |

---

## 4. 目录结构规范

```text
jingluo-3d/
├── .github/workflows/
│   └── deploy.yml                      # CI：数据校验 + GitHub Pages 自动部署
├── licenses/
│   ├── LICENSE-CODE-MIT                # 本项目代码许可（MIT）
│   ├── LICENSE-DATA-CC-BY-NC-SA-4.0    # 本项目数据与文档许可（CC BY-NC-SA 4.0）
│   └── UPSTREAM-AICUC-MIT.txt          # 上游 aicuc/3d-acupoint-atlas 原始 MIT 许可与版权声明
├── docs/
│   ├── PRD.md                          # 需求规格说明书
│   ├── ARCHITECTURE.md                 # 架构与数据规范（本文件）
│   └── AGENTS.md                       # AI 编程助手工程铁律
├── public/
│   └── models/
│       └── human-body.glb              # 源自 aicuc/3d-acupoint-atlas 的 3D 人体模型
├── data/
│   ├── schema/
│   │   ├── acupoint.schema.json        # 国标穴位文本校验 Schema
│   │   └── coord3d.schema.json         # 3D 坐标与复核状态校验 Schema
│   ├── meridians.json                  # 十四经脉元数据、标准配色与 3D 循行控制点
│   ├── acupoints/                      # 按经络拆分的国标与教材数据（LU.json, LI.json...）
│   └── coordinates-3d.json             # 3D 空间坐标、法向量、相机预设与复核状态
├── scripts/
│   ├── import_upstream.mjs             # 一次性迁移脚本：从上游项目导入坐标初稿
│   └── validate_data.mjs               # 自动化数据校验脚本
├── src/
│   ├── types/                          # 全局 TypeScript 类型定义（与 JSON Schema 严格一致）
│   ├── store/
│   │   └── useAtlasStore.ts            # Zustand 状态库
│   ├── engine/
│   │   ├── AssetLoader.ts              # 统一资产加载层（预留离线单文件扩展）
│   │   ├── MeridianScene.ts            # Three.js 场景、灯光、相机、防穿模经络渲染
│   │   └── RaycasterPicker.ts          # 3D 表面点击拾取与相机平滑插值聚焦
│   ├── components/
│   │   ├── layout/                     # ResponsiveShell（PC 侧栏 / 移动端 Bottom Sheet）
│   │   ├── AcupointCard.tsx            # 穴位国标定位、名解、由来、临床详情卡
│   │   └── ControlPanel.tsx            # 经络开关、检索框、特定穴筛选、盲测开关
│   ├── dev-tools/
│   │   └── AuditCalibration.tsx        # 【仅 DEV 模式】初稿复核与 3D 表面打点导出工具
│   └── App.tsx
├── LICENSE                             # 根目录总许可说明（指向双协议及上游声明）
└── package.json
```

---

## 5. 核心数据模型

### 5.1 穴位教学数据 (`data/acupoints/{MERIDIAN}.json`)
```json
{
  "code": "LU9",
  "standard": "GB/T 12346-2021",
  "name": "太渊",
  "pinyin": "Taiyuan",
  "meridianCode": "LU",
  "textbookScope": "undergraduate_core",
  "specialCategory": ["输穴", "原穴", "八会穴-脉会"],
  "gbLocation": "在腕前区，桡骨茎突与舟状骨之间，拇长展肌腱尺侧凹陷中。",
  "quickLocation": "掌心向上，腕掌侧远端横纹桡侧，桡动脉搏动处。",
  "etymology": {
    "meaning": "太，大也；渊，深潭也。该穴为手太阴肺经原穴，脉气深大，故名。",
    "origin": "《灵枢·本输》"
  },
  "clinical": {
    "functions": "理肺止咳，通调血脉",
    "indications": ["咳嗽", "气喘", "无脉症", "腕臂痛"],
    "operation": "避开桡动脉，直刺0.3～0.5寸。"
  }
}
```

### 5.2 3D 空间坐标与复核状态 (`data/coordinates-3d.json`)
```json
{
  "modelId": "aicuc-3d-acupoint-atlas-v1",
  "points": {
    "LU9": {
      "position": [0.342, 0.915, 0.084],
      "normal": [0.12, -0.05, 0.99],
      "cameraPreset": {
        "position": [0.55, 0.95, 0.45],
        "target": [0.342, 0.915, 0.084]
      },
      "audit": {
        "status": "draft_imported",
        "standard": "GB/T 12346-2021",
        "source": "aicuc/3d-acupoint-atlas",
        "verifiedAt": null
      }
    }
  }
}
```
* `audit.status` 枚举值：`"draft_imported"`（上游初稿待核） | `"gb_verified"`（已按 GB/T 12346-2021 校准）。

---

## 6. 关键技术机制

1. **3D 表面法向量贴合与防穿模**：
   * 穴位标记点（Marker）在世界坐标中沿 `normal` 方向向外微偏 `0.0015` 单位，避免与人体网格产生 Z-fighting（闪烁穿模）。
   * 经络连线采用 `THREE.CatmullRomCurve3` 拟合穴位点及辅助控制点，沿法向量外偏后生成细管 `THREE.TubeGeometry`，通过材质纹理 `offset` 或 Shader 实现气血流动动画。
2. **双端响应式断点**：
   * `>= 1024px`：三栏/两栏固定布局，画布占据剩余空间。
   * `< 768px`：画布占满 `100dvh`，详情面板采用底部可拖拽抽屉（收起/半屏/全屏三态），避免遮挡 3D 操作区。
3. **开发态隔离**：
   * `src/dev-tools/AuditCalibration.tsx` 仅在 `import.meta.env.DEV === true` 时挂载，生产构建时通过 Tree-Shaking 自动剔除。
