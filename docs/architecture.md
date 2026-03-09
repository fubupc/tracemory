# Tracemory — 架构设计文档

**Version:** 1.0 Draft | **Date:** 2026-03-08

---

## 1. 产品定义

**一句话**：开车发现美景 → 一键录制轨迹/视频 → AI 自动生成标签 → 发布到社区 → 其他人浏览/导航前往

**核心流程**：
1. 开车中，按一下 → 开始记录 GPS + 可选视频
2. 再按一下 → 结束
3. AI 自动生成标签/描述（基于轨迹位置 + 视频帧分析）
4. 用户确认/微调 → 发布
5. 其他用户在地图上浏览 → 看视频预览 → 导航前往
6. 结构化属性搜索（路面、环境、车流、设施、距离等）

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Tauri v2 Mobile App                      │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌─────────────────┐  │  │
│  │  │ Web UI      │  │ Rust     │  │ Native Plugins  │  │  │
│  │  │ (SolidJS)   │  │ Core     │  │ (Swift/Kotlin)  │  │  │
│  │  │ MapLibre GL │  │ Commands │  │ GPS, Camera     │  │  │
│  │  └──────┬──────┘  └────┬─────┘  └────────┬────────┘  │  │
│  │         └───────────────┴─────────────────┘           │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────┴────────────────────────────────────┐
│                     BACKEND SERVICES                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  API Gateway  │  │  Auth Svc    │  │  Notification Svc │  │
│  │  (Axum)      │  │  (JWT/OAuth) │  │  (Push / WS)      │  │
│  └──────┬───────┘  └──────────────┘  └───────────────────┘  │
│         │                                                    │
│  ┌──────┴───────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Route Svc   │  │  Media Svc   │  │  Search Svc       │  │
│  │  CRUD,       │  │  Upload,     │  │  PostGIS spatial  │  │
│  │  publish     │  │  transcode   │  │  + attribute      │  │
│  └──────────────┘  └──────┬───────┘  └───────────────────┘  │
│                           │                                  │
│  ┌────────────────────────┴──────────────────────────────┐  │
│  │              AI Processing Pipeline                    │  │
│  │  Message Queue (NATS JetStream)                       │  │
│  │  ┌────────┐ ┌──────────┐ ┌────────┐ ┌─────────────┐  │  │
│  │  │Transcode│ │Scene     │ │Tag/    │ │Cover Frame  │  │  │
│  │  │Worker   │ │Recogn.  │ │Title   │ │Selector     │  │  │
│  │  │(ffmpeg) │ │(Vision) │ │(LLM)   │ │(Vision)     │  │  │
│  │  └────────┘ └──────────┘ └────────┘ └─────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────────┐  │
│  │PostgreSQL│  │  Redis   │  │  S3-Compatible Storage    │  │
│  │+ PostGIS │  │  Cache   │  │  (MinIO / AWS S3)         │  │
│  └──────────┘  └──────────┘  └───────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 技术栈

### 3.1 客户端 (Tauri v2 Mobile)

| 层 | 技术 | 用途 |
|---|------|------|
| UI 框架 | SolidJS + TypeScript | 响应式 UI，体积小，性能好 |
| 地图 | MapLibre GL JS | 开源矢量地图，路线 polyline |
| Rust 核心 | Tauri v2 Commands | GPS 缓冲、本地 DB、离线缓存 |
| GPS | `@tauri-apps/plugin-geolocation` | 持续定位 |
| 摄像头 | 自定义 Swift/Kotlin 插件 | GPS 同步视频录制 |
| 本地存储 | SQLite (`tauri-plugin-sql`) | 离线路线草稿 |

### 3.2 后端

| 组件 | 技术 |
|------|------|
| HTTP 框架 | Axum 0.8.x |
| 异步运行时 | Tokio |
| 数据库查询 | SQLx（编译时检查） |
| 认证 | JWT (RS256) + OAuth2 (Apple/Google) |
| 消息队列 | NATS JetStream |
| 缓存 | Redis 7 |
| 对象存储 | S3 兼容 (MinIO / AWS S3) |
| 数据库 | PostgreSQL 16 + PostGIS 3.4 |

### 3.3 AI Pipeline

| 阶段 | 技术 |
|------|------|
| 视频转码 | FFmpeg (via `tokio::process`) |
| 帧提取 | FFmpeg scene detection + keyframe |
| 场景识别 | CLIP/SigLIP (Python sidecar 或 ONNX Runtime) |
| 标签/标题生成 | LLM API (Claude) structured output |
| 封面帧选择 | 美学评分模型 |
| 道路属性提取 | Vision + LLM chain |

---

## 4. 数据模型

### 4.1 实体关系

```
users ─┐
       ├──< routes ──< route_segments
       │       │──< route_media
       │       │──< route_attributes
       │       │──< route_tags
       │       └──< community_annotations
       ├──< bookmarks
       ├──< route_reviews
       └──< follows
```

### 4.2 核心表

#### `users`
```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(50) UNIQUE NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE,
    avatar_url      TEXT,
    auth_provider   VARCHAR(20) NOT NULL,
    auth_provider_id VARCHAR(255),
    bio             TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `routes`（核心实体）
```sql
CREATE TABLE routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'draft',
        -- 'draft', 'processing', 'ready', 'published', 'archived'

    -- 几何：完整路线 LINESTRING，WGS84
    track           GEOMETRY(LINESTRING, 4326) NOT NULL,
    bbox            GEOMETRY(POLYGON, 4326) NOT NULL,
    start_point     GEOMETRY(POINT, 4326) NOT NULL,
    end_point       GEOMETRY(POINT, 4326) NOT NULL,

    -- 统计
    distance_m      FLOAT NOT NULL,
    elevation_gain_m FLOAT,
    elevation_loss_m FLOAT,
    duration_s      INTEGER,
    avg_speed_kmh   FLOAT,

    -- AI 生成（用户可覆盖）
    ai_title        VARCHAR(200),
    ai_description  TEXT,
    cover_frame_url TEXT,

    -- 计数器（去范式化）
    view_count      INTEGER NOT NULL DEFAULT 0,
    bookmark_count  INTEGER NOT NULL DEFAULT 0,
    review_count    INTEGER NOT NULL DEFAULT 0,

    -- 位置上下文（反向地理编码）
    country         VARCHAR(100),
    region          VARCHAR(100),
    locality        VARCHAR(200),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_routes_track_gist ON routes USING GIST (track);
CREATE INDEX idx_routes_bbox_gist ON routes USING GIST (bbox);
CREATE INDEX idx_routes_start_point_gist ON routes USING GIST (start_point);
CREATE INDEX idx_routes_published ON routes (status, published_at DESC)
    WHERE status = 'published';
```

#### `route_segments`（GPS 轨迹含高程）
```sql
CREATE TABLE route_segments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id        UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    segment_index   SMALLINT NOT NULL,
    track           GEOMETRY(LINESTRINGZ, 4326) NOT NULL,
    timestamps      TIMESTAMPTZ[] NOT NULL,
    speeds_kmh      FLOAT[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (route_id, segment_index)
);
```

#### `route_attributes`（结构化搜索系统）
```sql
CREATE TABLE route_attributes (
    route_id        UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,

    -- 道路
    road_surface    VARCHAR(20)[],   -- ['asphalt','gravel','concrete','dirt']
    road_lanes      SMALLINT,
    road_curviness  VARCHAR(10),     -- 'straight', 'moderate', 'twisty'
    road_condition  VARCHAR(10),     -- 'excellent', 'good', 'fair', 'poor'

    -- 环境
    environment     VARCHAR(20)[],   -- ['mountain','seaside','rural','forest','desert']
    scenery_rating  SMALLINT,        -- 1-5

    -- 交通
    traffic_level   VARCHAR(10),     -- 'light', 'moderate', 'heavy'
    traffic_note    TEXT,

    -- 设施
    has_restrooms       BOOLEAN DEFAULT false,
    has_gas_stations    BOOLEAN DEFAULT false,
    has_scenic_overlooks BOOLEAN DEFAULT false,
    has_parking         BOOLEAN DEFAULT false,
    has_food            BOOLEAN DEFAULT false,
    facility_notes      TEXT,

    -- 体验
    recommended_seasons VARCHAR(10)[],
    best_time_of_day    VARCHAR(10)[],
    sun_direction       VARCHAR(20),
    difficulty          VARCHAR(10),

    -- 来源追踪
    attribute_sources   JSONB NOT NULL DEFAULT '{}',
    confidence_scores   JSONB NOT NULL DEFAULT '{}',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (route_id)
);

CREATE INDEX idx_route_attr_surface ON route_attributes USING GIN (road_surface);
CREATE INDEX idx_route_attr_environment ON route_attributes USING GIN (environment);
CREATE INDEX idx_route_attr_seasons ON route_attributes USING GIN (recommended_seasons);
CREATE INDEX idx_route_attr_traffic_surface ON route_attributes (traffic_level, road_curviness);
```

#### `route_media`
```sql
CREATE TABLE route_media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id        UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    media_type      VARCHAR(10) NOT NULL,    -- 'video', 'image'
    status          VARCHAR(20) NOT NULL DEFAULT 'uploading',
    original_url    TEXT NOT NULL,
    processed_url   TEXT,
    thumbnail_url   TEXT,
    hls_playlist_url TEXT,
    duration_s      FLOAT,
    width           INTEGER,
    height          INTEGER,
    size_bytes      BIGINT,
    gps_synced      BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `route_tags`
```sql
CREATE TABLE route_tags (
    route_id    UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    tag         VARCHAR(50) NOT NULL,
    source      VARCHAR(10) NOT NULL DEFAULT 'ai',
    confidence  FLOAT,
    PRIMARY KEY (route_id, tag)
);
CREATE INDEX idx_route_tags_tag ON route_tags (tag);
```

#### `community_annotations`
```sql
CREATE TABLE community_annotations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id    UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    field_name  VARCHAR(50) NOT NULL,
    field_value JSONB NOT NULL,
    vote_count  INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (route_id, user_id, field_name)
);
```

#### `route_reviews` / `bookmarks`
```sql
CREATE TABLE route_reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id    UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        TEXT,
    driven_at   DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (route_id, user_id)
);

CREATE TABLE bookmarks (
    user_id     UUID NOT NULL REFERENCES users(id),
    route_id    UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, route_id)
);
```

---

## 5. 核心 API 设计

### 5.1 认证
```
POST   /api/v1/auth/login/apple
POST   /api/v1/auth/login/google
POST   /api/v1/auth/refresh
DELETE /api/v1/auth/session
```

### 5.2 路线
```
POST   /api/v1/routes                  # 创建草稿
PATCH  /api/v1/routes/:id              # 更新草稿
POST   /api/v1/routes/:id/publish      # 发布
DELETE /api/v1/routes/:id              # 删除
GET    /api/v1/routes/:id              # 详情
GET    /api/v1/routes/:id/track        # GeoJSON 轨迹
GET    /api/v1/routes/:id/attributes   # 结构化属性
GET    /api/v1/routes/feed             # 信息流
GET    /api/v1/routes/nearby           # 附近路线
GET    /api/v1/routes/search           # 高级搜索
GET    /api/v1/routes/map-tiles        # 地图聚合标记
```

### 5.3 搜索 API（关键端点）

`GET /api/v1/routes/search` 参数：
```
# 空间
lat, lng, radius_km               # 中心 + 半径
bbox=sw_lat,sw_lng,ne_lat,ne_lng  # 或矩形范围

# 属性（可选，AND 逻辑）
road_surface=asphalt,gravel       # 字段内 OR
environment=rural,forest
traffic_level=light
road_curviness=twisty
min_distance_km=10
max_distance_km=100
has_scenic_overlooks=true
recommended_season=fall

# 排序 & 分页
sort=distance|newest|rating
cursor=<opaque>&limit=20
```

PostGIS 空间过滤优先（GiST 索引），再做属性过滤：
```sql
SELECT r.id, r.title, r.cover_frame_url, r.distance_m,
       ST_Distance(r.start_point::geography,
           ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS dist_m
FROM routes r
JOIN route_attributes ra ON ra.route_id = r.id
WHERE r.status = 'published'
  AND ST_DWithin(r.start_point::geography,
      ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 50000)
  AND ra.environment @> ARRAY['rural']
  AND ra.road_surface @> ARRAY['asphalt']
  AND ra.traffic_level = 'light'
  AND r.distance_m >= 10000
ORDER BY dist_m ASC
LIMIT 20;
```

### 5.4 媒体
```
POST   /api/v1/routes/:id/media/upload-url   # 获取预签名上传 URL
POST   /api/v1/routes/:id/media              # 确认上传，触发处理
GET    /api/v1/routes/:id/media              # 列出媒体
```

### 5.5 社区
```
POST   /api/v1/routes/:id/reviews
POST   /api/v1/routes/:id/annotations
POST   /api/v1/routes/:id/bookmark
DELETE /api/v1/routes/:id/bookmark
GET    /api/v1/users/me/bookmarks
GET    /api/v1/users/:id/routes
```

---

## 6. AI Pipeline 设计

```
上传视频 + GPS 轨迹
       │
       ▼
┌─────────────┐
│ Stage 1:    │  FFmpeg → HLS (480p/720p/1080p) + 预览 MP4
│ 转码        │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Stage 2:    │  场景检测 + 每 5s 抽帧 → 20-60 候选帧
│ 帧提取      │
└──────┬──────┘
       │
       ├───────────────┬──────────────────┐
       ▼               ▼                  ▼
┌────────────┐  ┌─────────────┐  ┌──────────────┐
│ 3a: 场景   │  │ 3b: 封面帧  │  │ 3c: 道路属性 │
│ 识别       │  │ 选择        │  │ 提取         │
│ (CLIP)     │  │ (美学评分)  │  │ (Vision+LLM) │
└─────┬──────┘  └──────┬──────┘  └──────┬───────┘
      │                │               │
      └────────────────┴───────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Stage 4:        │
              │ 标题/描述/标签  │
              │ 生成 (LLM)     │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Stage 5:        │
              │ 写入数据库      │
              │ 状态 → 'ready'  │
              │ 推送通知        │
              └─────────────────┘
```

**无视频路径**：跳过 1/2/3a/3b，用反向地理编码 + 高程数据 + 卫星图推断属性，自动生成地图缩略图作封面。

---

## 7. MVP 阶段划分

### Phase 1 — 录制 & 基础分享（第 1-6 周）
- Tauri v2 app 框架 + MapLibre 地图
- GPS 录制（开始/停止）
- 本地 SQLite 存储
- 后端：用户认证、路线 CRUD、GPS 上传
- 地图显示自己的路线
- **无视频、无 AI、无社区**
- **关键风险验证：Tauri v2 iOS 后台 GPS 录制可靠性**

### Phase 2 — 视频 + AI（第 7-12 周）
- 自定义 GPS+视频同步录制插件
- S3 上传 + 视频转码
- AI 场景识别 + 属性提取 + 标签/标题生成
- 封面帧选择
- 发布流程：AI 建议 → 用户确认 → 发布
- HLS 视频播放

### Phase 3 — 发现 & 搜索（第 13-18 周）
- 地图浏览（聚合标记、视口查询）
- 附近路线 + 高级属性搜索
- Feed 视图
- 收藏系统

### Phase 4 — 社区（第 19-24 周）
- 评价评分
- 社区属性标注
- 用户主页 + 关注
- 推送通知

### Phase 5 — 打磨 & 扩展（第 25-30 周）
- 导航集成（跳转 Apple Maps / Google Maps）
- 离线缓存
- 视频与地图联动（拖动进度条看地图位置）
- Android 发布
- 推荐算法

---

## 8. 项目目录结构

```
tracemory/
├── client/                          # Tauri v2 app
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── commands/           # recording.rs, upload.rs, cache.rs
│   │   │   ├── db/                 # 本地 SQLite
│   │   │   └── gps/               # GPS 处理、简化
│   │   ├── plugins/
│   │   │   └── video-recorder/     # 自定义插件 (Rust + Swift + Kotlin)
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── src/                        # Web 前端 (SolidJS)
│   │   ├── components/             # Map, RecordButton, RouteCard, SearchPanel, VideoPlayer
│   │   ├── pages/
│   │   ├── stores/
│   │   └── api/
│   └── package.json
│
├── server/                          # 后端 Rust workspace
│   ├── crates/
│   │   ├── api/                    # Axum HTTP 服务
│   │   ├── domain/                 # 领域类型 & 业务逻辑
│   │   ├── db/                     # SQLx 查询、迁移
│   │   ├── ai-pipeline/           # NATS 消费者 + AI 编排
│   │   └── common/                 # 共享工具（S3 client, config）
│   ├── ai-sidecar/                 # Python 推理服务 (FastAPI)
│   └── Cargo.toml                  # Workspace root
│
├── infra/                           # 部署
│   ├── docker-compose.yml          # 本地开发 (Postgres, Redis, MinIO, NATS)
│   ├── Dockerfile.*
│   └── terraform/
│
└── docs/
    └── architecture.md
```

---

## 9. 关键风险

| 风险 | 缓解 |
|------|------|
| Tauri v2 iOS 后台 GPS 录制可靠性 | Phase 1 第 1 周验证；备选：原生 Swift 插件 |
| 视频文件过大（长途驾驶 = 多 GB） | S3 分片上传；客户端 H.265 压缩；最大 30 分钟分段 |
| AI 属性提取准确度 | 置信度分数；低置信度让用户确认；社区纠正反馈 |
| PostGIS 大规模查询性能 (>100K 路线) | 空间索引 + EXPLAIN ANALYZE 调优；物化视图；读副本 |
| 地图渲染大量路线卡顿 | 服务端聚合；矢量瓦片 `ST_AsMVT`；按缩放级别渐进加载 |

---

## 10. 离线支持

- GPS 轨迹持续写入本地 SQLite（美景路段常无信号）
- 视频录制到本地文件系统
- 上传队列在网络恢复后自动同步
- 队列跨 app 重启持久化（SQLite）
- S3 分片上传支持断点续传
