# jingluo-3d — 3D 中医经络穴位教学系统

[![Code License: MIT](https://img.shields.io/badge/Code%20License-MIT-blue.svg)](./licenses/LICENSE-CODE-MIT)
[![Data & Docs License: CC BY-NC-SA 4.0](https://img.shields.io/badge/Data%20%26%20Docs-CC%20BY--NC--SA%204.0-lightgrey.svg)](./licenses/LICENSE-DATA-CC-BY-NC-SA-4.0)
[![Standard: GB/T 12346-2021](https://img.shields.io/badge/Standard-GB%2FT%2012346--2021-green.svg)](./docs/PRD.md)

面向中医专业师生打造的纯 Web 端 **3D 人体经络穴位交互式教学系统**，服务于本科《针灸学》课堂演示与课后自主复习。所有穴位名称、国际代码与体表定位严格对齐国家标准 **GB/T 12346-2021《经穴名称与定位》**。

---

## 核心特性

* **纯 3D 沉浸式交互**：基于原生 Three.js 封装独立渲染引擎，支持 360° 自由旋转/缩放/平移、标准解剖学视角一键切换，以及选中穴位后的平滑相机聚焦（`cameraPreset`）。
* **十四经脉防穿模可视化**：支持十二正经与任督二脉的独立开关、高亮聚焦；经络循行路径与穴位标记基于人体网格表面法向量微偏贴合，避免 Z-fighting 穿模，并支持动态气血流动演示。
* **国标结构化知识卡片**：完整呈现 **GB/T 12346-2021** 标准定位、临床简便取穴法、特定穴属性（五输穴、原穴、络穴、募穴、背俞穴、八会穴等）、穴位名解、典籍出处及临床功效主治与刺灸操作。
* **多维检索与教学盲测**：支持按穴位名、拼音/首字母、国标代码及主治病症实时检索，并内置隐藏标签的课堂盲测自测模式。
* **全端响应式适配**：桌面端（`>= 1024px`）采用多栏教学工作台布局；移动端（`< 768px`）采用 `100dvh` 全屏画布 + 可拖拽底部抽屉（Bottom Sheet），并针对触控拾取与像素比（`devicePixelRatio <= 2`）做专项优化。
* **开发态 3D 国标复核工具**：内置仅在开发环境挂载的 `AuditCalibration` 标定工具，可视化区分上游初稿（`draft_imported`）与国标已核（`gb_verified`），支持直接在 3D 人体表面重打点并导出最新坐标 JSON。

---

## 技术栈与架构

| 层次 | 选型 | 说明 |
| :--- | :--- | :--- |
| **构建与语言** | Vite + TypeScript (`strict: true`) | 强类型约束，保障数据模型与渲染接口一致性 |
| **UI 与样式** | React 18 + Tailwind CSS | 仅负责 UI 面板与双端响应式布局 |
| **状态管理** | Zustand | 支持在 Three.js 引擎内直接订阅，实现 React 与 3D 渲染循环隔离 |
| **3D 渲染引擎** | 原生 Three.js | 独立封装于 `src/engine/`，可控内存释放，不引入 R3F |
| **数据校验** | Node.js (`.mjs`) + JSON Schema | 确定性校验国标编码唯一性、字段完整性及坐标复核状态 |
| **部署托管** | GitHub Actions + GitHub Pages | 自动校验数据并构建发布（资产层已为离线单文件打包预留抽象） |

---

## 项目文档

* [产品需求规格说明书 (`docs/PRD.md`)](./docs/PRD.md)
* [系统架构与数据规范 (`docs/ARCHITECTURE.md`)](./docs/ARCHITECTURE.md)
* [AI 编程助手工程规范 (`docs/AGENTS.md`)](./docs/AGENTS.md)

---

## 目录结构规划

```text
jingluo-3d/
├── .github/workflows/          # CI 数据校验与 GitHub Pages 部署
├── licenses/                   # 双协议许可文件与上游版权声明
│   ├── LICENSE-CODE-MIT
│   ├── LICENSE-DATA-CC-BY-NC-SA-4.0
│   └── UPSTREAM-AICUC-MIT.txt
├── docs/                       # PRD、架构设计、工程规范
├── public/models/              # 3D 人体模型（源自 aicuc/3d-acupoint-atlas）
├── data/                       # JSON Schema、经络元数据、国标穴位文本与 3D 坐标
├── scripts/                    # 上游坐标导入脚本与自动化数据校验脚本
├── src/
│   ├── types/                  # TypeScript 类型定义
│   ├── store/                  # Zustand 全局状态库
│   ├── engine/                 # 原生 Three.js 渲染引擎、拾取器与统一资产加载层
│   ├── components/             # 响应式外壳、控制面板、穴位详情卡
│   └── dev-tools/              # 【仅 DEV】3D 表面国标复核标定工具
├── LICENSE                     # 根目录双协议总说明
└── README.md
```

---

## 分期路线图

* ✅ **Phase 1 (MVP)**：已完成 3D 引擎骨架、上游模型与初稿坐标导入、开发态 3D 复核工具及**手太阴肺经（11 穴）**完整教学闭环。
* ✅ **Phase 2 (核心教学版)**：已覆盖本科《针灸学》十四经脉全部 **151 个核心三维穴位**（`LU / LI / ST / SP / HT / SI / BL / KI / PC / TE / GB / LR / CV / GV`）的 GB/T 12346-2021 标准文本录入、拼音首字母多维检索、随机抽考盲测与青玉/肤色/铜人材质主题切换（支持通过内置复核台持续校准 3D 坐标）。
* ⏳ **Phase 3 (全量与增强版)**：补全十四经脉全部 361 穴三维打点与教学文本、推进 Draco 模型压缩及单文件离线 HTML 打包方案。

---

## 本地开发与校验

```bash
# 安装依赖
npm install

# 启动本地开发服务器（含 DEV 模式 3D 坐标复核工具）
npm run dev

# 提交前完整自检
npm run typecheck
node scripts/validate_data.mjs
npm run build
```

---

## 开源许可（Dual License）

本项目按资产属性采用 **双协议（Dual License）** 开源，详见根目录 [`LICENSE`](./LICENSE)：

| 范围 | 协议 | 说明 |
| :--- | :--- | :--- |
| **源代码**（`src/`、`scripts/` 及构建/CI 配置） | **[MIT License](./licenses/LICENSE-CODE-MIT)** | 允许自由使用、修改、合并、发布与商用，需保留版权与许可声明。 |
| **校准数据与教学文档**（`data/`、`docs/`） | **[CC BY-NC-SA 4.0](./licenses/LICENSE-DATA-CC-BY-NC-SA-4.0)** | 允许高校师生免费用于教学与学习及二次改进，须署名、以相同方式共享，**禁止未经授权的商业用途**。 |

---

## 上游致谢与合规声明

* 本项目的 3D 人体模型及初稿穴位坐标源自开源项目 **[`aicuc/3d-acupoint-atlas`](https://github.com/aicuc/3d-acupoint-atlas)**（观穴·3D 东方人体经络穴位交互图谱，采用 **MIT License**）。完整的上游版权声明与 MIT 许可全文保存在 [`licenses/UPSTREAM-AICUC-MIT.txt`](./licenses/UPSTREAM-AICUC-MIT.txt)。
* 3D 渲染基于 **[Three.js](https://threejs.org/)**（MIT License）。
* 穴位名称、国际代码与标准定位参考国家标准 **GB/T 12346-2021《经穴名称与定位》** 及本科《针灸学》规划教材。

> **免责声明**：本项目仅用于中医针灸教学演示与学术交流，不构成任何医疗诊断或临床治疗建议。
